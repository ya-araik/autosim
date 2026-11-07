"""Durable SmartShell workflow, restricted to the server-configured club ID."""
import re
import os
import secrets
from datetime import date
from app import DAY, CRM_DAYS, ApiError, fail, fields, stamp, parse_instant
from smartshell import CLIENT_FIELDS, FOREVER, PROBES, RemoteError, shell_time, shell_instant

TEST_CLUB = os.environ.get('SMARTSHELL_WRITE_CLUB_ID', '')
BOOK_FIELDS = 'id group hosts from to status comment client { id uuid }'
CREATE_CLIENT = 'mutation AutosimRegister($input:RegisterInput!) { register(input:$input) { '+CLIENT_FIELDS+' } }'
VERIFY_CLIENT = 'mutation AutosimVerifyClient($id:Int!,$input:VerifyUserInput!) { verifyUser(id:$id,input:$input) { '+CLIENT_FIELDS+' } }'
SEND_CODE = 'mutation AutosimSendCode($input:SendConfirmationCodeInput!) { sendClientConfirmationCode(input:$input) }'
CREATE_BOOKING = 'mutation AutosimCreateBooking($input:BookingInput!) { createBooking(input:$input) { '+BOOK_FIELDS+' } }'
UPDATE_BOOKING = 'mutation AutosimUpdateBooking($id:Int!,$input:BookingInput!) { updateBooking(id:$id,input:$input) { '+BOOK_FIELDS+' } }'
STATUS_BOOKING = 'mutation AutosimBookingStatus($id:Int!,$status:BookingStatus!) { setBookingStatus(id:$id,status:$status) { '+BOOK_FIELDS+' } }'
MUTATIONS = {CREATE_CLIENT, CREATE_BOOKING, UPDATE_BOOKING, STATUS_BOOKING}
VERIFICATION_MUTATIONS = {VERIFY_CLIENT, SEND_CODE}
GET_BOOKING = 'query AutosimBooking($id:Int!) { getBooking(id:$id) { '+BOOK_FIELDS+' } }'
SEARCH_CLIENT = 'query AutosimFindClient($input:ClientsInput!) { clients: searchClients(input:$input,first:100,page:1) { data { '+CLIENT_FIELDS+' } paginatorInfo { hasMorePages } } }'
SCHEDULE = 'query AutosimCheckSchedule($from:DateTime,$to:DateTime) { getBookings(from:$from,to:$to,first:100,page:1) { data { '+BOOK_FIELDS+' } paginatorInfo { hasMorePages } } }'
ACTIVE_SCHEDULE = 'query AutosimActiveSchedule($hosts:[Int!],$page:Int!) { hostsOverview { id in_service online_booking_enabled } getBookings(hostIds:$hosts,status:"ACTIVE",first:100,page:$page) { data { '+BOOK_FIELDS+' } paginatorInfo { hasMorePages } } }'
MESSAGES = {
    'queued':'Ожидает синхронизации', 'waiting_owner':'Ожидает подтверждения клуба',
    'waiting_profile':'Сначала свяжите профиль SmartShell', 'synced':'Сохранено в SmartShell',
    'conflict':'Расписание или запись изменились. Нужна проверка администратора',
    'uncertain':'Ответ не получен. Проверяем запись без повторного создания',
    'processing':'Синхронизация выполняется', 'error':'SmartShell отклонил действие',
    'paused':'Запись в SmartShell выключена', 'not_needed':'Удалённая бронь не создавалась',
    'needs_profile_data':'Добавьте телефон и дату рождения в профиле',
    'needs_link':'Клиент уже есть в SmartShell. Администратор проверит и свяжет профили',
    'needs_verification':'SmartShell ожидает подтверждения телефона',
    'needs_review':'Нужна проверка администратора: повторное создание остановлено',
}


class ShellSync:
    def __init__(self, connector):
        self.ss, self.app = connector, connector.app
        self.transport = self.http

    @staticmethod
    def http(token, query, variables):
        if query not in MUTATIONS | VERIFICATION_MUTATIONS: raise RemoteError('mutation_not_allowed')
        return __import__('smartshell').SmartShell._http(token, query, variables)

    def allowed(self, config):
        return bool(TEST_CLUB) and config.get('clubId') == TEST_CLUB

    def enabled(self, config):
        return self.allowed(config) and config.get('writeMode') == 'test'

    def safe_job(self, job):
        if not job: return None
        return {k:job.get(k) for k in ('id','kind','guestId','bookingId','state','message','code','diagnostic','updatedAt','remoteId','attempts','desiredVersion','syncedVersion')}

    def summary(self, tx, guest_id=None):
        jobs=self.app.scan(tx,'ss_jobs')
        if guest_id: jobs=[j for j in jobs if j['guestId']==guest_id]
        return [self.safe_job(j) for j in sorted(jobs,key=lambda j:j.get('updatedAt',''),reverse=True)[:100]]

    def configure(self, request, session, now):
        self.app.access.require(session,'owner')
        data=request.body();fields(data,{'enabled','version'})
        if type(data.get('enabled'))!=bool: fail(400,'invalid_mode','Выберите режим.')
        def save(tx):
            config=tx.get('ss_config','main') or {};self.app.check_version(data,config)
            if not TEST_CLUB or config.get('clubId') != TEST_CLUB or config.get('status',{}).get('state')!='connected':
                fail(403,'test_club_only','ID подключённого клуба должен совпадать с SMARTSHELL_WRITE_CLUB_ID на сервере.')
            config.update(writeMode='test' if data['enabled'] else 'off',version=config['version']+1)
            tx.put('ss_config','main',config,FOREVER)
            self.app.audit(tx,now,'smartshell.mode',details={'mode':config['writeMode'],'clubId':TEST_CLUB})
            return config
        return self.ss.safe(self.app.atomic(save,now),session,now)

    def registration(self, tx, data, user, guest, now):
        if not self.enabled(tx.get('ss_config','main') or {}):return
        user['_ssTestClub']=TEST_CLUB;guest['_ssTestClub']=TEST_CLUB

    def queue_profile(self, tx, user, now):
        if not self.enabled(tx.get('ss_config','main') or {}) or tx.get('ss_links',user['guestId']): return
        key='profile:'+user['guestId'];old=tx.get('ss_jobs',key)
        if old:
            if old['state']=='needs_profile_data' and user.get('phone') and user.get('birthDate'):
                old.update(state='queued',message=MESSAGES['queued'],nextAt=0,updatedAt=stamp(now));tx.put('ss_jobs',key,old,now+CRM_DAYS*DAY)
            return
        job={'id':key,'kind':'profile','guestId':user['guestId'],'memberId':user['id'],
             'login':'as_'+user.get('username','pilot')[:18]+'_'+user['id'].replace('-','')[:6], 'state':'queued', 'message':MESSAGES['queued'],'attempts':0,
             'createdAt':stamp(now),'updatedAt':stamp(now),'desiredVersion':1}
        tx.put('ss_jobs',key,job,now+CRM_DAYS*DAY)

    def queue_booking(self, tx, booking, now):
        guest=tx.get('guests',booking.get('guestId') or '')
        if not self.enabled(tx.get('ss_config','main') or {}):return
        booking['integrationTest']=True
        key='booking:'+booking['id'];old=tx.get('ss_jobs',key) or {}
        state='waiting_owner' if booking['status']=='draft' and not booking.get('_hostIds') else 'queued'
        if old.get('state') in {'processing','uncertain','conflict'}:state=old['state']
        if old.get('state')=='conflict' and old.get('code') in {'no_capacity','selected_seat_busy'} and old.get('desiredVersion')!=booking['version']:
            state='queued'
        if booking['status']=='cancelled' and old.get('state')=='conflict':state='queued'
        if booking['status']=='cancelled' and not old.get('remoteId') and not old.get('dispatched') and old.get('state')!='processing':
            state='not_needed';old.update(message=MESSAGES[state],syncedVersion=booking['version'],code=None,diagnostic=None)
        old.update(id=key,kind='booking',guestId=guest['id'] if guest else None,bookingId=booking['id'],
                   desiredVersion=booking['version'],state=state,updatedAt=stamp(now))
        old.setdefault('attempts',0)
        tx.put('ss_jobs',key,old,now+CRM_DAYS*DAY)

    def stamp_result(self, key, now, state, **extra):
        def save(tx):
            job=tx.get('ss_jobs',key)
            if not job:return None
            job.update(state=state,message=MESSAGES.get(state,state),updatedAt=stamp(now),**extra)
            tx.put('ss_jobs',key,job,now+CRM_DAYS*DAY)
            self.app.seats.notice(tx,job,now)
            self.app.audit(tx,now,'smartshell.sync.'+state,job['kind'],job.get('bookingId') or job['guestId'],
                           {'remoteId':job.get('remoteId'),'code':job.get('code'),'version':job.get('syncedVersion')})
            return self.safe_job(job)
        return self.app.atomic(save,now)

    def dispatch(self, config, key, query, variables, now):
        if query not in MUTATIONS or not self.enabled(config):raise RemoteError('writes_disabled')
        # Persist BEFORE sending. A worker crash is an uncertain delivery, not a retry.
        self.app.atomic(lambda tx:self._mark_dispatch(tx,key,now),now)
        self.ss.budget(now)
        return self.transport(self.ss.token(config),query,variables)

    def _mark_dispatch(self, tx, key, now):
        current=tx.get('ss_config','main') or {}
        if not self.enabled(current):raise RemoteError('writes_disabled')
        job=tx.get('ss_jobs',key);job['dispatched']=True
        tx.put('ss_jobs',key,job,now+CRM_DAYS*DAY)

    def process(self, key, now):
        config=self.ss.config(now)
        if not self.enabled(config):return None
        lease=secrets.token_hex(16)
        def claim(tx):
            job=tx.get('ss_jobs',key)
            if not job or job['state'] in {'synced','not_needed','waiting_owner','conflict','needs_profile_data','needs_link','needs_verification','needs_review'}:return None
            guest=tx.get('guests',job.get('guestId') or '')
            if job['kind']=='profile' and not guest:return None
            lock=tx.get('ss_locks','write')
            if lock and lock['until']>now:return None
            if job.get('nextAt',0)>now:return None
            job['recovering']=job.get('dispatched',False) or job['state']=='uncertain'
            job.update(state='processing',attempts=job.get('attempts',0)+1,updatedAt=stamp(now),lease=lease)
            tx.put('ss_jobs',key,job,now+CRM_DAYS*DAY)
            tx.put('ss_locks','write',{'lease':lease,'until':now+90},now+120)
            return job
        job=self.app.atomic(claim,now)
        if not job:return None
        try:
            club=self.ss.query(config,PROBES['club'],{},now).get('currentClub')
            if not club or str(club['id'])!=TEST_CLUB:raise RemoteError('club_mismatch')
            if job['kind']=='profile':return self.profile(config,job,now)
            return self.booking(config,job,now)
        except (RemoteError,ApiError) as e:
            code=e.code
            current=self.app.atomic(lambda tx:tx.get('ss_jobs',key),now) or {}
            # Explicit rejection is known; transport failures after dispatch are not.
            known=code.startswith('remote_validation') or code in {'permission_denied','rate_limited','writes_disabled'}
            uncertain=job.get('recovering') or (current.get('dispatched') and not known)
            if code=='rate_limited' and not uncertain:
                # A known rejected/budgeted request has no remote side effect.
                # Keep it queued for the next minute, without a false conflict
                # alert or asking the visitor to submit a second reservation.
                return self.stamp_result(key,now,'queued',code=code,dispatched=False,nextAt=now+65)
            return self.stamp_result(key,now,'uncertain' if uncertain else 'error',code=code,
                                     diagnostic=getattr(e,'diagnostic',None),dispatched=bool(uncertain),nextAt=now+300)
        except Exception:
            current=self.app.atomic(lambda tx:tx.get('ss_jobs',key),now) or {}
            return self.stamp_result(key,now,'uncertain' if current.get('dispatched') else 'error',code='unexpected_response',nextAt=now+60)
        finally:
            def release(tx):
                lock=tx.get('ss_locks','write') or {}
                if lock.get('lease')==lease:tx.delete('ss_locks','write')
            self.app.atomic(release,now)

    def profile(self, config, job, now):
        linked=self.app.atomic(lambda tx:tx.get('ss_links',job['guestId']),now)
        if linked:return self.stamp_result(job['id'],now,'synced',remoteId=linked['id'],syncedVersion=1,dispatched=False,code=None,diagnostic=None)
        saved=job.get('remoteClientResponse')
        if saved and type(saved.get('id'))==int and saved['id']>0 and not saved.get('uuid'):
            return self.stamp_result(job['id'],now,'needs_verification',remoteId=saved['id'],dispatched=False,code=None,diagnostic=None)
        result=self.ss.query(config,SEARCH_CLIENT,{'input':{'q':job['login']}},now)['clients']
        exact=[r for r in result['data'] if r.get('login')==job['login'] or r.get('nickname')==job['login']]
        if result['paginatorInfo']['hasMorePages'] or len(exact)>1:raise RemoteError('ambiguous_client')
        if exact:remote=exact[0]
        elif job.get('recovering'):
            return self.stamp_result(job['id'],now,'needs_review' if job['attempts']>=5 else 'uncertain',code='client_not_found_after_dispatch',nextAt=now+300)
        else:
            user=self.app.atomic(lambda tx:tx.get('members',job['memberId']),now) or {}
            if not user.get('phone') or not user.get('birthDate'):
                return self.stamp_result(job['id'],now,'needs_profile_data',dispatched=False)
            matches=self.ss.query(config,SEARCH_CLIENT,{'input':{'q':re.sub(r'\D','',user['phone'])}},now)['clients']
            # A claimed phone is not proof of identity. Existing accounts require
            # the administrator's explicit link, never an automatic takeover.
            if matches['data'] or matches['paginatorInfo']['hasMorePages']:
                return self.stamp_result(job['id'],now,'needs_link',dispatched=False)
            self.app.atomic(lambda tx:self._remember_phone(tx,job['id'],re.sub(r'\D','',user['phone']),now),now)
            remote=self.dispatch(config,job['id'],CREATE_CLIENT,{'input':{
                'login':job['login'],'phone':re.sub(r'\D','',user['phone']),'password':secrets.token_urlsafe(18)+'!',
                'dob':user['birthDate'],'first_name':user.get('name','')[:30],'type':'MANAGER','news_consent':False,
                'consents':{'privacy_policy':True,'marketing':False}}},now).get('register')
            if remote:
                self.app.atomic(lambda tx:self._save_client_response(tx,job['id'],remote,now),now)
                if type(remote.get('id'))==int and remote['id']>0 and not remote.get('uuid') and remote.get('login')==re.sub(r'\D','',user['phone']):
                    return self.stamp_result(job['id'],now,'needs_verification',remoteId=remote['id'],dispatched=False,code=None,diagnostic=None)
        if not remote or job['login'] not in (remote.get('login'),remote.get('nickname')) or not remote.get('uuid'):
            raise RemoteError('invalid_client_response',{'returnedFields':[k for k in CLIENT_FIELDS.split() if (remote or {}).get(k) is not None]})
        return self.link_created(job,remote,now)

    def link_created(self,job,remote,now):
        def link(tx):
            other=tx.get('ss_reverse',TEST_CLUB+':'+remote['uuid'])
            if other and other['guestId']!=job['guestId']:raise RemoteError('already_linked')
            old=tx.get('ss_links',job['guestId'])
            if old and old['uuid']!=remote['uuid']:raise RemoteError('already_linked')
            value={'guestId':job['guestId'],'clubId':TEST_CLUB,'uuid':remote['uuid'],'id':remote['id'],
                   'nickname':remote.get('nickname') or remote['login'],'linkedAt':stamp(now),'version':1,'test':True}
            tx.put('ss_links',job['guestId'],value,FOREVER)
            tx.put('ss_reverse',TEST_CLUB+':'+remote['uuid'],{'guestId':job['guestId']},FOREVER)
            tx.delete('ss_profile_intents',job['guestId'])
            for booking in self.app.scan(tx,'bookings'):
                if booking.get('guestId')==job['guestId'] and booking['status']=='confirmed':self.queue_booking(tx,booking,now)
        self.app.atomic(link,now)
        return self.stamp_result(job['id'],now,'synced',remoteId=remote['id'],syncedVersion=1,dispatched=False,code=None,diagnostic=None)

    def _remember_phone(self,tx,key,phone,now):
        job=tx.get('ss_jobs',key);job['verificationPhone']=phone
        tx.put('ss_jobs',key,job,now+CRM_DAYS*DAY)

    def verify_member(self,request,user,now):
        data=request.body();fields(data,{'action','code'})
        action=data.get('action')
        if action not in ('send','verify'):fail(400,'invalid_action','Выберите действие.')
        code=data.get('code','')
        if action=='verify' and (not isinstance(code,str) or not re.fullmatch(r'[0-9]{4,12}',code)):
            fail(400,'invalid_code','Введите код SmartShell.')
        config=self.ss.config(now)
        if not self.enabled(config):fail(409,'not_connected','Подключение клуба выключено.')
        key='profile:'+user['guestId']
        def claim(tx):
            job=tx.get('ss_jobs',key) or {}
            remote=job.get('remoteClientResponse') or {}
            phone=job.get('verificationPhone') or remote.get('login')
            if job.get('state')=='synced':return None
            if job.get('state')!='needs_verification' or type(remote.get('id'))!=int or remote['id']<=0:
                fail(409,'not_ready','Сначала дождитесь создания клубного профиля.')
            if phone!=re.sub(r'\D','',user.get('phone','')):fail(409,'phone_changed','Телефон изменился. Попросите администратора проверить привязку.')
            if job.get('verificationBusyUntil',0)>now:fail(409,'in_progress','Предыдущий запрос ещё выполняется.')
            limit,period=(1,90) if action=='send' else (5,600)
            if not self.app.rate(tx,'ss:verify:'+action+':'+user['id'],now,limit,period):fail(429,'rate_limited','Подождите перед следующей попыткой.')
            if action=='send' and not self.app.rate(tx,'ss:send:daily:'+user['id'],now,3,DAY):fail(429,'rate_limited','Лимит отправок на сегодня исчерпан. Обратитесь в клуб.')
            job['verificationBusyUntil']=now+30;tx.put('ss_jobs',key,job,now+CRM_DAYS*DAY)
            return job,phone,remote
        pending=self.app.atomic(claim,now)
        if not pending:return {'state':'synced'}
        job,phone,remote=pending
        try:
            club=self.ss.query(config,PROBES['club'],{},now).get('currentClub')
            if not club or str(club['id'])!=TEST_CLUB:raise RemoteError('club_mismatch')
            self.ss.budget(now)
            if action=='send':
                result=self.transport(self.ss.token(config),SEND_CODE,{'input':{'phone':phone,'type':'REGISTER','method':'CASCADE'}})
                if result.get('sendClientConfirmationCode') is not True:raise RemoteError('verification_not_sent')
                return {'state':'needs_verification','message':'Запрос подтверждения отправлен SmartShell. Введите полученный код.'}
            result=self.transport(self.ss.token(config),VERIFY_CLIENT,{'id':remote['id'],'input':{'code':code}}).get('verifyUser')
            if not result or result.get('id')!=remote['id'] or not result.get('uuid'):raise RemoteError('verification_not_completed')
            return self.link_created(job,result,now)
        except (RemoteError,ApiError):
            fail(409,'verification_failed','SmartShell не подтвердил действие. Проверьте код. Если требуется звонок или CAPTCHA, завершите подтверждение в SmartShell с администратором.')
        finally:
            def release(tx):
                current=tx.get('ss_jobs',key)
                if current:current['verificationBusyUntil']=0;tx.put('ss_jobs',key,current,now+CRM_DAYS*DAY)
            self.app.atomic(release,now)

    def _save_client_response(self,tx,key,remote,now):
        job=tx.get('ss_jobs',key)
        job['remoteClientResponse']={k:remote.get(k) for k in ('id','uuid','login','nickname')}
        tx.put('ss_jobs',key,job,now+CRM_DAYS*DAY)

    @staticmethod
    def fingerprint(row):
        return {'hosts':sorted(row.get('hosts') or []),'from':stamp(shell_instant(row['from']).timestamp()),
                'to':stamp(shell_instant(row['to']).timestamp()),'status':row['status'],
                'client':(row.get('client') or {}).get('id')}

    def booking(self, config, job, now):
        booking,link=self.app.atomic(lambda tx:(tx.get('bookings',job['bookingId']),tx.get('ss_links',job.get('guestId') or '')),now)
        if not booking:raise RemoteError('local_booking_missing')
        remote_id=job.get('remoteId');status=booking['status']
        if status=='draft' and not booking.get('_hostIds'):return self.stamp_result(job['id'],now,'waiting_owner')
        reserving=status in {'draft','confirmed'}
        if not remote_id and status in {'cancelled','completed'} and not job.get('recovering'):
            return self.stamp_result(job['id'],now,'not_needed',syncedVersion=booking['version'])
        # A seat can be reserved before a club account is verified. It remains
        # explicitly anonymous remotely; a verified link later attaches the client.
        if not link:link={'clubId':TEST_CLUB,'id':None}
        if link['clubId']!=TEST_CLUB:raise RemoteError('club_mismatch')
        start,end=booking['startsAt'],booking['endsAt']
        marker='AUTOSIM:'+booking['id']
        remote=None
        if remote_id:
            remote=self.ss.query(config,GET_BOOKING,{'id':remote_id},now)['getBooking']
            if marker not in (remote.get('comment') or ''):raise RemoteError('remote_identity_changed')
            if job.get('remoteSnapshot') and self.fingerprint(remote)!=job['remoteSnapshot']:
                safe_cancel=status=='cancelled' and self.fingerprint(remote)['client']==job['remoteSnapshot']['client']
                if not job.get('recovering') and not safe_cancel:
                    return self.stamp_result(job['id'],now,'conflict',code='remote_changed')
        schedule=None
        if not remote_id and job.get('recovering'):
            # Recovery searches the interval actually dispatched, even after a local edit.
            interval=job.get('dispatchInterval') if job.get('recovering') else None
            schedule=self.ss.query(config,SCHEDULE,{'from':shell_time(interval[0] if interval else start),'to':shell_time(interval[1] if interval else end)},now)['getBookings']
            if schedule['paginatorInfo']['hasMorePages']:raise RemoteError('schedule_truncated')
            matches=[b for b in schedule['data'] if marker in (b.get('comment') or '')]
            identities={b.get('group') or 'id:'+str(b['id']) for b in matches}
            if len(identities)>1:raise RemoteError('duplicate_remote_booking')
            if len(matches)>1 and any(self.fingerprint(b)!=self.fingerprint(matches[0]) for b in matches):
                raise RemoteError('inconsistent_remote_group')
            if not remote_id and matches:remote=matches[0];remote_id=remote['id']
        if job.get('recovering'):
            if not remote:return self.stamp_result(job['id'],now,'uncertain',code='booking_not_found_after_dispatch',nextAt=now+60)
            desired=job.get('dispatchExpected')
            if desired and self.fingerprint(remote)!=desired:
                return self.stamp_result(job['id'],now,'conflict',remoteId=remote_id,code='uncertain_remote_differs')
            return self.finish_booking(job,booking,remote,job.get('dispatchVersion',booking['version']),now)
        hosts=list(booking.get('_hostIds') or (config.get('mapping') or {}).get(booking['tariff'],[]))
        target_status={'draft':'ACTIVE','confirmed':'ACTIVE','cancelled':'CANCELED','completed':'FINISHED'}[status]
        if reserving:
            if parse_instant(start).timestamp()<=now:raise RemoteError('booking_in_past')
            # Do not rely on undocumented date-filter overlap semantics. Include
            # bookings starting before this slot, with bounded pagination.
            active=[]
            for page in range(1,6):
                response=self.ss.query(config,ACTIVE_SCHEDULE,{'hosts':hosts,'page':page},now)
                equipment=response['hostsOverview'];chunk=response['getBookings']
                active.extend(chunk['data'])
                if not chunk['paginatorInfo']['hasMorePages']:break
            else:raise RemoteError('schedule_truncated')
            hosts=[h for h in hosts if any(e['id']==h and not e['in_service'] and e['online_booking_enabled'] for e in equipment)]
            occupied=set()
            for b in active:
                own_group=(remote or {}).get('group')
                if b['id']==remote_id or (own_group and b.get('group')==own_group) or b['status']!='ACTIVE':continue
                if shell_instant(b['from'])<parse_instant(end) and shell_instant(b['to'])>parse_instant(start):occupied.update(b['hosts'] or [])
            free=[h for h in hosts if h not in occupied]
            if booking.get('_hostIds'):
                if any(h not in free for h in booking['_hostIds']):
                    return self.stamp_result(job['id'],now,'conflict',code='selected_seat_busy')
                free=list(booking['_hostIds'])
            if len(free)<booking['participants']:return self.stamp_result(job['id'],now,'conflict',code='no_capacity')
            current_hosts=(remote or {}).get('hosts') or []
            free=sorted(free,key=lambda h:h not in current_hosts)
            hosts=free[:booking['participants']]
        else:hosts=remote['hosts']
        expected={'hosts':sorted(hosts),'from':start if reserving else self.fingerprint(remote)['from'],
                  'to':end if reserving else self.fingerprint(remote)['to'], 'status':target_status,'client':link['id']}
        if remote and self.fingerprint(remote)==expected:return self.finish_booking(job,booking,remote,booking['version'],now)
        def intent(tx):
            current=tx.get('ss_jobs',job['id']);current.update(dispatchInterval=[start,end],dispatchVersion=booking['version'],dispatchExpected=expected)
            tx.put('ss_jobs',job['id'],current,now+CRM_DAYS*DAY)
        self.app.atomic(intent,now)
        if not reserving:
            result=self.dispatch(config,job['id'],STATUS_BOOKING,{'id':remote_id,'status':target_status},now)['setBookingStatus']
        else:
            body={'hosts':hosts,'client':link['id'],'from':shell_time(start),'to':shell_time(end),'status':'ACTIVE',
                  'comment':(marker+' | '+booking.get('guestName','')+' | '+booking.get('phone','')+' | VR '+str(booking.get('vrCount',0)))[:256]}
            query=UPDATE_BOOKING if remote_id else CREATE_BOOKING
            variables={'input':body}
            if remote_id:variables['id']=remote_id
            result=self.dispatch(config,job['id'],query,variables,now)['updateBooking' if remote_id else 'createBooking']
        if not result or self.fingerprint(result)!=expected:raise RemoteError('write_response_mismatch')
        return self.finish_booking(job,booking,result,booking['version'],now)

    def finish_booking(self, job, booking, remote, version, now):
        current=self.app.atomic(lambda tx:tx.get('bookings',booking['id']),now)
        state='synced' if current and current['version']==version else 'queued'
        return self.stamp_result(job['id'],now,state,remoteId=remote['id'],remoteGroup=remote.get('group'),remoteSnapshot=self.fingerprint(remote),
                                 syncedVersion=version,dispatched=False,recovering=False,nextAt=0,code=None,diagnostic=None)

    def kick(self, key, now):
        # Local success must survive temporary external failure.
        try:return self.process(key,now)
        except Exception:return None

    def tick(self, now):
        """One durable operation per minute, then bounded remote reconciliation."""
        config=self.ss.config(now)
        if not self.enabled(config):return
        self.app.atomic(lambda tx:tx.put('ss_worker','status',{'lastRun':stamp(now)},FOREVER),now)
        jobs=self.app.atomic(lambda tx:self.app.scan(tx,'ss_jobs'),now)
        # Surface pre-existing unresolved conflicts after upgrading as well.
        for old in jobs:
            if old['kind']=='booking' and old['state'] in {'conflict','error','uncertain'} and not old.get('noticeKey'):
                def notify(tx):
                    booking=tx.get('bookings',old['bookingId'])
                    if booking and booking['status'] in {'draft','confirmed'} and parse_instant(booking['endsAt']).timestamp()>now:
                        self.app.seats.notice(tx,tx.get('ss_jobs',old['id']),now)
                self.app.atomic(notify,now)
        eligible=[j for j in jobs if j['state'] in {'queued','processing','uncertain','error','waiting_profile'}
                  and j.get('nextAt',0)<=now]
        if eligible:
            # Profiles unlock bookings; stable ordering still prevents a failing
            # profile starving the queue forever because nextAt backs it off.
            eligible.sort(key=lambda j:(j.get('nextAt',0),j.get('updatedAt','')))
            return self.kick(eligible[0]['id'],now)
        candidates=[j for j in jobs if j['kind']=='booking' and j['state']=='synced' and j.get('remoteId')
                    and j.get('checkedAt',0)<=now-300 and (j.get('remoteSnapshot') or {}).get('status')=='ACTIVE']
        if not candidates:return
        job=min(candidates,key=lambda j:j.get('checkedAt',0))
        try:
            remote=self.ss.query(config,GET_BOOKING,{'id':job['remoteId']},now)['getBooking']
            def checked(tx):
                current=tx.get('ss_jobs',job['id'])
                if current.get('state')!='synced' or current.get('desiredVersion')!=job.get('desiredVersion'):return
                current['checkedAt']=now
                if 'AUTOSIM:'+job['bookingId'] not in (remote.get('comment') or '') or self.fingerprint(remote)!=job.get('remoteSnapshot'):
                    current.update(state='conflict',code='remote_changed',message=MESSAGES['conflict'],updatedAt=stamp(now))
                tx.put('ss_jobs',job['id'],current,now+CRM_DAYS*DAY)
                if current['state']=='conflict':self.app.seats.notice(tx,current,now)
            self.app.atomic(checked,now)
        except (RemoteError,ApiError):pass

    def handle(self, route, request, session, now):
        if route=='mode' and request.method=='PATCH':return self.configure(request,session,now)
        if route=='jobs' and request.method=='GET':
            self.app.access.require(session,'smartshell.bookings')
            return {'items':self.app.atomic(lambda tx:self.summary(tx),now)}
        if route=='sync' and request.method=='POST':
            data=request.body();fields(data,{'id','retry','acceptRemote'})
            key=data.get('id','')
            if not isinstance(key,str) or not re.fullmatch(r'(profile|booking):[a-f0-9-]{36}',key):fail(400,'invalid_job','Выберите запись.')
            self.app.access.require(session,'smartshell.clients.write' if key.startswith('profile:') else 'smartshell.bookings.write')
            if data.get('retry'):
                def retry(tx):
                    job=tx.get('ss_jobs',key)
                    if not job:fail(404,'not_found','Задача не найдена.')
                    if job.get('dispatched') or job['state'] in {'processing','uncertain'}:return
                    if job['state']=='conflict':fail(409,'conflict_unresolved','Сначала сверяйте запись со SmartShell.')
                    job.update(state='queued',nextAt=0);tx.put('ss_jobs',key,job,now+CRM_DAYS*DAY)
                self.app.atomic(retry,now)
            if data.get('acceptRemote'):return self.pull(key,session,now)
            result=self.process(key,now)
            return result or self.app.atomic(lambda tx:self.safe_job(tx.get('ss_jobs',key)),now)
        fail(404,'not_found','Действие интеграции не найдено.')

    def pull(self,key,session,now):
        self.app.access.require(session,'bookings.write')
        job=self.app.atomic(lambda tx:tx.get('ss_jobs',key),now)
        if not job or job['kind']!='booking' or not job.get('remoteId'):fail(409,'not_linked','Удалённая бронь ещё не связана.')
        config=self.ss.config(now)
        if not self.enabled(config):fail(403,'test_club_only','Только тестовый клуб.')
        remote=self.ss.remote(config,GET_BOOKING,{'id':job['remoteId']},now)['getBooking']
        if 'AUTOSIM:'+job['bookingId'] not in (remote.get('comment') or ''):fail(409,'identity_mismatch','Идентификатор записи изменён.')
        snapshot=self.fingerprint(remote)
        def apply(tx):
            b=tx.get('bookings',job['bookingId']);current=tx.get('ss_jobs',key)
            if current.get('state')=='processing':fail(409,'in_progress','Дождитесь текущей операции.')
            if current.get('desiredVersion')!=job.get('desiredVersion') or current.get('remoteId')!=job.get('remoteId'):
                fail(409,'version_conflict','Заявка уже изменилась. Обновите данные и повторите сверку.')
            link=tx.get('ss_links',job.get('guestId') or '') or {}
            if snapshot['client']!=link.get('id'):fail(409,'client_changed','Клиент удалённой брони изменился. Требуется ручная проверка.')
            tariff=next((t for t,ids in config.get('mapping',{}).items() if snapshot['hosts'] and set(snapshot['hosts'])<=set(ids)),None)
            duration=int((parse_instant(snapshot['to'])-parse_instant(snapshot['from'])).total_seconds()/60)
            mapped={'ACTIVE':'confirmed','CANCELED':'cancelled','FINISHED':'completed'}.get(snapshot['status'])
            inventory=self.app.seats.inventory(config)
            selected=[s for s in inventory if s['host'] in snapshot['hosts']]
            if len(selected)!=len(snapshot['hosts']) or duration not in (30,60,120) or not mapped or not 1<=len(selected)<=10:
                fail(409,'unsupported_remote_change','Новые параметры SmartShell нельзя автоматически перенести в заявку.')
            if b['status'] in {'cancelled','completed'} and mapped!=b['status']:fail(409,'closed_booking','Закрытая заявка требует ручного решения.')
            b.update(startsAt=snapshot['from'],endsAt=snapshot['to'],duration=duration,tariff=tariff or 'mixed',participants=len(snapshot['hosts']),
                     status=mapped,version=b['version']+1,updatedAt=stamp(now),proposal=None)
            from app import PRICES,VR_PRICES
            b['vrCount']=min(b.get('vrCount',0),b['participants'])
            b['_hostIds']=[s['host'] for s in selected]
            self.app.seats.price_selection(b,[s['id'] for s in selected])
            tx.put('bookings',b['id'],b,now+CRM_DAYS*DAY)
            current.update(state='synced',message=MESSAGES['synced'],dispatched=False,remoteSnapshot=snapshot,
                           syncedVersion=b['version'],desiredVersion=b['version'],code=None,updatedAt=stamp(now))
            tx.put('ss_jobs',key,current,now+CRM_DAYS*DAY)
            self.app.audit(tx,now,'smartshell.pull','bookings',b['id'],{'remoteId':remote['id']})
            return self.safe_job(current)
        return self.app.atomic(apply,now)
