"""Allowlisted SmartShell connector. General access is read-only; the isolated test workflow has allowlisted writes.

HTTP happens outside retryable database transactions. Credentials are authenticated
encrypted at rest; client responses and audit records never contain the token.
"""
import base64
import hashlib
import hmac
import json
import secrets
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from app import DAY, CRM_DAYS, fail, fields, integer, stamp, text_field

ENDPOINT = 'https://billing.smartshell.gg/api/graphql'
FOREVER = 9999999999
HOST_FIELDS = 'id alias group_id online in_service online_booking_enabled'
CLIENT_FIELDS = 'id uuid nickname login first_name last_name phone'
PROBES = {
    'club': 'query AutosimClub { currentClub { id name city timezone } }',
    'subscription': 'query AutosimSubscription { featureFlags { subscription expires_at modules host_count } }',
    'equipment': 'query AutosimEquipment { hostsOverview { '+HOST_FIELDS+' } }',
    'clients': 'query AutosimClientsAccess { clients(first:1,page:1) { paginatorInfo { total } } }',
    'bookings': 'query AutosimBookingsAccess { getBookings(first:1,page:1) { paginatorInfo { total } } }',
}
ROOTS = {'club':'currentClub','subscription':'featureFlags','equipment':'hostsOverview',
         'clients':'clients','bookings':'getBookings'}
LABELS = {'club':'Клуб', 'subscription':'Подписка и модули', 'equipment':'Кокпиты',
          'clients':'Клиенты', 'bookings':'Брони'}
AUTH_LOGIN = 'mutation AutosimLogin($input:LoginInput!) { login(input:$input) { access_token refresh_token expires_in token_type } }'
AUTH_REFRESH = 'mutation AutosimRefresh($input:RefreshTokenInput!) { refreshToken(input:$input) { access_token refresh_token expires_in token_type } }'

def shell_time(value):
    """SmartShell v1 DateTime is club wall time, not ISO 8601."""
    from app import parse_instant
    return parse_instant(value).astimezone(timezone(timedelta(hours=5))).strftime('%Y-%m-%d %H:%M:%S')

def shell_instant(value):
    from app import parse_instant
    if isinstance(value,str) and len(value)==19 and value[10]==' ':
        return datetime.strptime(value,'%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone(timedelta(hours=5)))
    return parse_instant(value)


class RemoteError(Exception):
    def __init__(self, code, diagnostic=None):
        self.code = code
        self.diagnostic = diagnostic


class SmartShell:
    def __init__(self, app, transport=None, auth_transport=None):
        self.app = app
        self.transport = transport or self.http
        self.auth_transport = auth_transport or self.auth_http
        from smartshell_sync import ShellSync
        self.sync = ShellSync(self)

    def crypt(self):
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        key = hmac.new(self.app.config.secret.encode(), b'autosim.smartshell.token.v1', hashlib.sha256).digest()
        return AESGCM(key)

    def seal(self, token):
        nonce = secrets.token_bytes(12)
        return base64.b64encode(nonce+self.crypt().encrypt(nonce,token.encode(),b'smartshell:v1')).decode()

    def token(self, config, key='_token'):
        try:
            raw = base64.b64decode(config[key], validate=True)
            return self.crypt().decrypt(raw[:12],raw[12:],b'smartshell:v1').decode()
        except Exception:
            fail(503,'token_unavailable','Сервер не может расшифровать токен. Владелец должен подключить его заново.')

    def config(self, now):
        return self.app.atomic(lambda tx: tx.get('ss_config','main') or {'version':0}, now)

    @staticmethod
    def http(token, query, variables):
        # No arbitrary URL, header or GraphQL is accepted from the browser.
        if not query.lstrip().startswith('query '):
            raise RemoteError('read_only')
        return SmartShell._http(token, query, variables)

    @staticmethod
    def auth_http(query, variables):
        if query not in (AUTH_LOGIN, AUTH_REFRESH):
            raise RemoteError('read_only')
        return SmartShell._http(None, query, variables)

    @staticmethod
    def _http(token, query, variables):
        headers={'Content-Type':'application/json','User-Agent':'AutosimIntegration/1.0'}
        if token: headers['Authorization']='Bearer '+token
        req = urllib.request.Request(ENDPOINT, data=json.dumps({'query':query,'variables':variables}).encode(),
            headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=3) as response:
                raw = response.read(2_000_001)
                if len(raw)>2_000_000: raise RemoteError('response_too_large')
                result = json.loads(raw)
        except urllib.error.HTTPError as error:
            raise RemoteError('permission_denied' if error.code in (401,403) else 'rate_limited' if error.code==429 else 'unavailable') from None
        except (OSError, ValueError):
            raise RemoteError('unavailable') from None
        if not isinstance(result,dict): raise RemoteError('unavailable')
        errors = result.get('errors')
        if errors:
            # Never forward remote errors: they can echo inputs or server internals.
            raw = json.dumps(errors).lower()
            diagnostic={
                'flags':[word for word in ('phone','captcha','register','login','dob','password','validation','required','invalid','length','already','exists','disabled','deprecated','v2','internal','type','unknown','field','manager','date','format') if word in raw],
                'codes':[e.get('extensions',{}).get('code') for e in errors if isinstance(e,dict) and type(e.get('extensions',{}).get('code'))==int],
            }
            if any(x in raw for x in ('not permitted','unauthenticated','unauthorized','permission','"401"','"403"')):
                raise RemoteError('permission_denied')
            # Report a bounded reason, never vendor text or submitted values.
            for field in ('captcha','phone','dob','login','password','consents','hosts','from','to'):
                if any(field in str(e.get('extensions',{}).get('validation',{})).lower() for e in errors if isinstance(e,dict)):
                    raise RemoteError('remote_validation_'+field,diagnostic)
            raise RemoteError('schema_or_access_error',diagnostic)
        if not isinstance(result.get('data'),dict): raise RemoteError('unavailable')
        return result['data']

    def budget(self, now):
        # Shared budget across workers and all staff. The vendor limit also includes
        # requests from other integrations, so leave headroom and do not auto-retry.
        allowed = self.app.atomic(lambda tx: self.app.rate(tx,'ss:requests',now,15,60), now)
        if not allowed: raise RemoteError('rate_limited')

    def query(self, config, query, variables, now):
        if not config.get('_token'): fail(409,'not_connected','Сначала подключите SmartShell в кабинете владельца.')
        if not query.startswith('query '): fail(403,'read_only','Изменения SmartShell в этом подключении выключены.')
        if config.get('_refresh') and config.get('expiresAt',0) < now+30:
            self.renew(config,now)
        self.budget(now)
        return self.transport(self.token(config),query,variables)

    def credential_fields(self, data, now):
        if not isinstance(data,dict) or str(data.get('token_type','')).lower()!='bearer':
            raise RemoteError('invalid_auth_response')
        access,refresh=data.get('access_token'),data.get('refresh_token')
        ttl=data.get('expires_in')
        if not isinstance(access,str) or not 20 <= len(access) <= 16384 or any(c.isspace() for c in access):
            raise RemoteError('invalid_auth_response')
        if type(ttl)!=int or not 60 <= ttl <= 366*DAY:
            raise RemoteError('invalid_auth_response')
        if not isinstance(refresh,str) or not 20 <= len(refresh) <= 16384 or any(c.isspace() for c in refresh):
            raise RemoteError('invalid_auth_response')
        return {'_token':self.seal(access),'_refresh':self.seal(refresh),'expiresAt':now+ttl,'authMode':'account','refreshUncertain':False}

    def owner_login(self, request, session, now):
        self.app.access.require(session,'owner')
        data=request.body();fields(data,{'login','password','clubId','version'})
        old=self.config(now);self.app.check_version(data,old)
        login=text_field(data.get('login',''),'логин SmartShell',100,True)
        password=data.get('password')
        if not isinstance(password,str) or not 1 <= len(password) <= 256:
            fail(400,'invalid_password','Введите пароль SmartShell.')
        club=integer(data.get('clubId'),'ID клуба',1,2147483647)
        if old.get('clubId') and old['clubId']!=str(club):
            fail(409,'club_mismatch','Действующее подключение относится к другому клубу.')
        if not self.app.atomic(lambda tx:self.app.rate(tx,'ss:login',now,3,900),now):
            fail(429,'login_limited','Не больше трёх попыток входа за 15 минут.')
        try:
            self.budget(now)
            result=self.auth_transport(AUTH_LOGIN,{'input':{'login':login,'password':password,'company_id':club}})
            candidate=dict(old,**self.credential_fields(result.get('login'),now))
            status=self.probe(candidate,now)
        except RemoteError:
            fail(502,'smartshell_login_failed','SmartShell не подтвердил вход. Проверьте данные и ID клуба; прежнее подключение сохранено.')
        finally:
            password=None
        if not status.get('club') or str(status['club'].get('id'))!=str(club):
            fail(409,'club_unverified','Вход не подтвердил выбранный клуб. Прежнее подключение сохранено.')
        def save(tx):
            current=tx.get('ss_config','main') or {'version':0};self.app.check_version(data,current)
            candidate.update(version=current['version']+1,credentialRevision=secrets.token_hex(16),
                clubId=str(club),status=status,updatedAt=stamp(now))
            tx.put('ss_config','main',candidate,FOREVER)
            self.app.audit(tx,now,'smartshell.login',details={'clubId':str(club),'state':status['state']})
        self.app.atomic(save,now)
        return self.safe(candidate,session,now)

    def renew(self, config, now):
        """Single refresh across workers. Never replay an uncertain rotating token."""
        lease=secrets.token_hex(16)
        def claim(tx):
            current=tx.get('ss_config','main') or {}
            if current.get('clubId')!=config.get('clubId'): raise RemoteError('connection_changed')
            if current.get('credentialRevision')!=config.get('credentialRevision'):
                return current
            lock=tx.get('ss_locks','refresh')
            if lock and lock.get('until',0)>now: raise RemoteError('refresh_pending')
            if current.get('refreshUncertain'): raise RemoteError('reauth_required')
            tx.put('ss_locks','refresh',{'lease':lease,'until':now+30},now+60)
            return None
        newer=self.app.atomic(claim,now)
        if newer is not None:
            config.clear();config.update(newer)
            return
        try:
            self.budget(now)
            result=self.auth_transport(AUTH_REFRESH,{'input':{'refresh_token':self.token(config,'_refresh')}})
            updated=self.credential_fields(result.get('refreshToken'),now)
            self.budget(now)
            club=self.transport(self.token(updated),PROBES['club'],{}).get('currentClub')
            if not club or str(club.get('id'))!=config['clubId']: raise RemoteError('club_mismatch')
            def save(tx):
                current=tx.get('ss_config','main') or {};lock=tx.get('ss_locks','refresh') or {}
                if lock.get('lease')!=lease or current.get('credentialRevision')!=config.get('credentialRevision'):
                    raise RemoteError('connection_changed')
                current.update(updated,credentialRevision=secrets.token_hex(16),refreshUncertain=False)
                tx.put('ss_config','main',current,FOREVER);tx.delete('ss_locks','refresh')
                return current
            config.update(self.app.atomic(save,now))
        except Exception:
            def uncertain(tx):
                current=tx.get('ss_config','main') or {};lock=tx.get('ss_locks','refresh') or {}
                if lock.get('lease')==lease:
                    tx.delete('ss_locks','refresh')
                    if current.get('credentialRevision')==config.get('credentialRevision'):
                        current['refreshUncertain']=True;tx.put('ss_config','main',current,FOREVER)
            self.app.atomic(uncertain,now)
            raise RemoteError('reauth_required') from None

    def probe(self, config, now):
        result = {'checkedAt':stamp(now),'capabilities':{},'club':None,'subscription':None}
        # First prove club identity. A payment-only token must not trigger broad reads.
        try:
            result['club'] = self.query(config,PROBES['club'],{},now).get('currentClub')
            if not result['club'] or not result['club'].get('id'): raise RemoteError('unavailable')
            result['capabilities']['club'] = 'available'
        except RemoteError as error:
            result['capabilities']['club'] = error.code
            for name in PROBES:
                result['capabilities'].setdefault(name,'unknown')
            result['state'] = 'restricted' if error.code=='permission_denied' else 'unavailable'
            return result
        # Independent probes preserve the distinction between a denied module and
        # an unavailable subscription query. At most five read requests per refresh.
        for name in ('subscription','equipment','clients','bookings'):
            try:
                data = self.query(config,PROBES[name],{},now).get(ROOTS[name])
                if data is None: raise RemoteError('unavailable')
                result['capabilities'][name] = 'available'
                if name=='subscription': result['subscription']=data
            except RemoteError as error:
                result['capabilities'][name] = error.code
        result['state']='connected'
        return result

    def safe(self, config, session, now):
        user = session['user']
        status = config.get('status') or {'state':'not_connected','capabilities':{}}
        caps = {k:v for k,v in status.get('capabilities',{}).items()
                if user['isOwner'] or 'smartshell.'+k in user['permissions']}
        result = {'configured':bool(config.get('_token')),'readOnly':not self.sync.enabled(config),'writeMode':config.get('writeMode','off'),'state':status['state'],
                  'club':status.get('club'),'checkedAt':status.get('checkedAt'), 'capabilities':caps,
                  'labels':LABELS,'version':config.get('version',0)}
        if user['isOwner']:
            result.update(writeAllowed=self.sync.allowed(config),subscription=status.get('subscription'),mapping=config.get('mapping',{}),
                          tokenPresent=bool(config.get('_token')), linkedClubId=config.get('clubId'),
                          authMode=config.get('authMode','token'),expiresAt=stamp(config['expiresAt']) if config.get('expiresAt') else None,
                          reauthRequired=bool(config.get('refreshUncertain')))
            result['queue'] = self.app.atomic(lambda tx: {'profiles':len(self.app.scan(tx,'ss_profile_intents')),
                'bookings':len(self.app.scan(tx,'ss_booking_intents'))},now)
            result['worker']=self.app.atomic(lambda tx:tx.get('ss_worker','status'),now)
        return result

    def owner_config(self, request, session, now):
        self.app.access.require(session,'owner')
        data = request.body()
        fields(data,{'token','version'})
        old = self.config(now)
        self.app.check_version(data,old)
        token = text_field(data.get('token',''),'токен',4096,True)
        if any(c.isspace() for c in token) or len(token)<20: fail(400,'invalid_token','Проверьте токен: без пробелов и переноса строки.')
        candidate = dict(old,_token=self.seal(token),authMode='token',credentialRevision=secrets.token_hex(16))
        for key in ('_refresh','expiresAt','refreshUncertain'): candidate.pop(key,None)
        status = self.probe(candidate,now)
        club_id = str(status['club']['id']) if status.get('club') else None
        if old.get('clubId') and club_id != old['clubId']:
            fail(409,'club_mismatch','Токен не подтвердил доступ к ранее подключённому клубу. Действующее подключение сохранено.')
        def save(tx):
            latest = tx.get('ss_config','main') or {'version':0}
            self.app.check_version(data,latest)
            candidate.update(version=latest['version']+1,status=status,clubId=club_id,updatedAt=stamp(now))
            tx.put('ss_config','main',candidate,FOREVER)
            self.app.audit(tx,now,'smartshell.connect',details={'state':status['state'],'clubId':club_id})
        self.app.atomic(save,now)
        return self.safe(candidate,session,now)

    def refresh(self, request, session, now):
        self.app.access.require(session,'owner')
        fields(request.body(),{'version'})
        config = self.config(now)
        self.app.check_version(request.body(),config)
        if not config.get('_token'): fail(409,'not_connected','Введите токен.')
        if not self.app.atomic(lambda tx:self.app.rate(tx,'ss:probe',now,1,60),now):
            fail(429,'probe_limited','Повторная проверка доступна через минуту.')
        status = self.probe(config,now)
        club_id = str(status['club']['id']) if status.get('club') else None
        if club_id and config.get('clubId') and club_id != config['clubId']: fail(409,'club_mismatch','Клуб в ответе API изменился. Синхронизация остановлена.')
        def save(tx):
            current=tx.get('ss_config','main')
            self.app.check_version({'version':config['version']},current)
            current.update(status=status,clubId=config.get('clubId') or club_id,version=config['version']+1,updatedAt=stamp(now))
            tx.put('ss_config','main',current,FOREVER)
            self.app.audit(tx,now,'smartshell.check',details={'state':status['state']})
            return current
        return self.safe(self.app.atomic(save,now),session,now)

    def ready(self, session, feature, now):
        self.app.access.require(session,'smartshell.'+feature)
        config=self.config(now)
        if not config.get('clubId') or config.get('status',{}).get('state')!='connected':
            fail(409,'connection_unverified','Токен ещё не подтвердил доступ к клубу. Владелец может проверить подключение.')
        if config['status']['capabilities'].get(feature)!='available':
            fail(403,'feature_unavailable','API не подтвердил доступ к этой функции. Это не означает, что её нет в тарифе.')
        return config

    def remote(self, config, query, variables, now):
        try: return self.query(config,query,variables,now)
        except RemoteError as error:
            messages={'permission_denied':'SmartShell отказал в доступе. Проверьте права и срок действия токена.',
                      'rate_limited':'Лимит запросов SmartShell. Повторите через минуту.',
                      'reauth_required':'Нужно повторно войти в SmartShell из раздела подключения владельца.',
                      'refresh_pending':'Доступ SmartShell обновляется. Повторите запрос через несколько секунд.'}
            fail(429 if error.code=='rate_limited' else 502,'smartshell_'+error.code,
                 messages.get(error.code,'SmartShell не подтвердил запрос. Данные клуба не изменены.'))

    def equipment(self, session, now):
        config=self.ready(session,'equipment',now)
        return {'items':self.remote(config,PROBES['equipment'],{},now)['hostsOverview']}

    def clients(self, request, session, now):
        config=self.ready(session,'clients',now)
        query=text_field(request.query.get('q',''),'поиск',100,True)
        if len(query)<3: fail(400,'query_short','Введите от трёх символов: ник, имя или телефон.')
        data=self.remote(config,'query AutosimSearch($input:ClientsInput!) { clients: searchClients(input:$input,first:20,page:1) { data { '+CLIENT_FIELDS+' } paginatorInfo { hasMorePages total } } }',{'input':{'q':query}},now)
        return {'items':data['clients']['data'],'more':data['clients']['paginatorInfo']['hasMorePages']}

    def bookings(self, request, session, now):
        config=self.ready(session,'bookings',now)
        try:
            day=datetime.strptime(request.query.get('date',''),'%Y-%m-%d').replace(tzinfo=timezone(timedelta(hours=5)))
        except ValueError: fail(400,'invalid_date','Укажите дату расписания.')
        # SmartShell accepts DateTime; the club offset is explicit, not machine local time.
        data=self.remote(config,'query AutosimSchedule($from:DateTime,$to:DateTime) { getBookings(from:$from,to:$to,first:100,page:1) { data { id group hosts from to status } paginatorInfo { hasMorePages total } } }',
                         {'from':day.strftime('%Y-%m-%d %H:%M:%S'),'to':(day+timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S')},now)['getBookings']
        for row in data['data']:
            for key in ('from','to'):row[key]=stamp(shell_instant(row[key]).timestamp())
        return {'items':data['data'],'more':data['paginatorInfo']['hasMorePages']}

    def mapping(self, request, session, now):
        self.app.access.require(session,'owner')
        data=request.body();fields(data,{'version','mapping'})
        config=self.ready(session,'equipment',now)
        self.app.check_version(data,config)
        mapping=data.get('mapping')
        if not isinstance(mapping,dict) or set(mapping)!={'standard','pro','vip'}: fail(400,'invalid_mapping','Укажите места для всех трёх комплектаций.')
        known={h['id'] for h in self.equipment(session,now)['items']}
        seen=set()
        for ids in mapping.values():
            if not isinstance(ids,list) or any(type(x)!=int or x not in known or x in seen for x in ids) or len(ids)!=len(set(ids)):
                fail(400,'invalid_mapping','Каждое существующее место может относиться только к одной комплектации.')
            seen.update(ids)
        def save(tx):
            current=tx.get('ss_config','main');self.app.check_version(data,current)
            current.update(mapping=mapping,version=current['version']+1)
            tx.put('ss_config','main',current,FOREVER)
            self.app.audit(tx,now,'smartshell.mapping',details={'mapping':mapping})
            return current
        return self.safe(self.app.atomic(save,now),session,now)

    def link(self, request, session, now):
        self.app.access.require(session,'profiles.link')
        data=request.body();fields(data,{'guestId','uuid','confirmed','version'})
        if data.get('confirmed') is not True: fail(400,'confirmation_required','Проверьте принадлежность обоих профилей одному человеку.')
        config=self.ready(session,'clients',now)
        guest_id=text_field(data.get('guestId',''),'карточка',40,True)
        remote_uuid=text_field(data.get('uuid',''),'UUID клиента',100,True)
        remote=self.remote(config,'query AutosimClient($uuid:String!) { user(uuid:$uuid) { '+CLIENT_FIELDS+' } }',{'uuid':remote_uuid},now)['user']
        if not remote or remote.get('uuid')!=remote_uuid: fail(409,'client_not_found','SmartShell не подтвердил клиента.')
        reverse=config['clubId']+':'+remote_uuid
        def save(tx):
            current=tx.get('ss_config','main')
            if current.get('clubId')!=config['clubId'] or current['version']!=config['version']: fail(409,'connection_changed','Подключение изменилось. Повторите поиск.')
            guest=tx.get('guests',guest_id)
            if not guest: fail(404,'not_found','Карточка клиента не найдена.')
            old=tx.get('ss_links',guest_id) or {'version':0}
            self.app.check_version(data,old)
            if old.get('uuid') and old['uuid']!=remote_uuid: fail(409,'already_linked','Карточка уже связана с другим клиентом. Автоматическая замена запрещена.')
            other=tx.get('ss_reverse',reverse)
            if other and other['guestId']!=guest_id: fail(409,'already_linked','Этот клиент SmartShell уже связан с другой карточкой сайта.')
            link={'guestId':guest_id,'clubId':config['clubId'],'uuid':remote_uuid,'id':remote['id'],
                  'nickname':remote.get('nickname') or remote.get('login'),'linkedAt':stamp(now),'version':old['version']+1}
            tx.put('ss_links',guest_id,link,FOREVER);tx.put('ss_reverse',reverse,{'guestId':guest_id},FOREVER)
            job=tx.get('ss_jobs','profile:'+guest_id)
            if job:
                job.update(state='synced',message='Профиль связан со SmartShell',remoteId=remote['id'],dispatched=False,code=None,diagnostic=None,updatedAt=stamp(now))
                tx.put('ss_jobs',job['id'],job,now+CRM_DAYS*DAY)
            tx.delete('ss_profile_intents',guest_id)
            for booking in self.app.scan(tx,'bookings'):
                if booking.get('guestId')==guest_id and booking['status']=='confirmed':self.sync.queue_booking(tx,booking,now)
            self.app.audit(tx,now,'smartshell.link','guests',guest_id,{'clubId':config['clubId'],'uuid':remote_uuid})
            return link
        return self.app.atomic(save,now)

    def queue_profile(self, tx, user, now):
        self.sync.queue_profile(tx,user,now)
        if self.sync.enabled(tx.get('ss_config','main') or {}):
            tx.delete('ss_profile_intents',user['guestId']);return
        if not tx.get('ss_config','main') or tx.get('ss_links',user['guestId']): return
        tx.put('ss_profile_intents',user['guestId'],{'guestId':user['guestId'],'memberId':user['id'],
               'state':'read_only','createdAt':stamp(now),'reason':'Нужны права создания клиента, проверка телефона и обязательные данные SmartShell.'},now+365*DAY)

    def queue_booking(self, tx, booking, now):
        self.sync.queue_booking(tx,booking,now)
        if self.sync.enabled(tx.get('ss_config','main') or {}):
            tx.delete('ss_booking_intents',booking['id']);return
        if not tx.get('ss_config','main'): return
        # A local intent is not a remote reservation. Do not mark bookings synced.
        tx.put('ss_booking_intents',booking['id'],{'bookingId':booking['id'],'guestId':booking.get('guestId'),
               'version':booking['version'],'status':booking['status'],'state':'read_only',
               'updatedAt':stamp(now)},now+CRM_DAYS*DAY)

    def profile(self, tx, guest_id):
        return {'link':tx.get('ss_links',guest_id),'registration':tx.get('ss_profile_intents',guest_id),
                'jobs':self.sync.summary(tx,guest_id),'readOnly':not self.sync.enabled(tx.get('ss_config','main') or {}),'configured':bool(tx.get('ss_config','main'))}

    def handle(self, request, session, now):
        route=request.path.removeprefix('/api/admin/smartshell').strip('/')
        method=request.method
        if route in {'mode','jobs','sync'}:return self.sync.handle(route,request,session,now)
        if route=='' and method=='GET':
            if not session['user']['isOwner'] and not any(p.startswith('smartshell.') for p in session['user']['permissions']):
                fail(403,'permission_denied','SmartShell недоступен для вашей роли.')
            return self.safe(self.config(now),session,now)
        if route=='' and method=='POST': return self.owner_config(request,session,now)
        if route=='login' and method=='POST': return self.owner_login(request,session,now)
        if route=='check' and method=='POST': return self.refresh(request,session,now)
        if route=='equipment' and method=='GET': return self.equipment(session,now)
        if route=='clients' and method=='GET': return self.clients(request,session,now)
        if route=='bookings' and method=='GET': return self.bookings(request,session,now)
        if route=='mapping' and method=='PATCH': return self.mapping(request,session,now)
        if route=='link' and method=='POST': return self.link(request,session,now)
        fail(404,'not_found','Функция подключения не найдена.')
