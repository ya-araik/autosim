"""Private client cards, game controls and explicitly reviewed race claims."""
import re
import uuid
from app import DAY, ApiError, fail, fields, flag, integer, public_record, stamp, text_field

DEFAULTS = {'version': 1, 'enabled': True, 'startsPerHour': 180,
            'startsPerIpHour': 600, 'finishesPerHour': 180, 'reviewsPerDay': 10,
            'reviewsEnabled': True, 'maintenanceMessage': 'Заезды временно на технической паузе. Скоро вернёмся.'}


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9-]{36}', value):
        fail(400, 'invalid_id', 'Некорректный идентификатор.')
    return value


class ClubAdmin:
    def __init__(self, app):
        self.app = app

    def settings(self, tx):
        return dict(DEFAULTS, **(tx.get('game_settings', 'main') or {}))

    def configure(self, request, now):
        if request.method == 'GET':
            return self.app.atomic(self.settings, now)
        if request.method != 'PATCH':
            fail(405, 'method_not_allowed', 'Метод не поддерживается.')
        data = request.body()
        fields(data, DEFAULTS)
        def change(tx):
            old = self.settings(tx)
            self.app.check_version(data, old)
            new = dict(old)
            for key in ('enabled', 'reviewsEnabled'):
                if key in data:
                    new[key] = flag(data[key], key)
            for key, maximum in [('startsPerHour', 3600), ('startsPerIpHour', 10000),
                                 ('finishesPerHour', 3600), ('reviewsPerDay', 100)]:
                if key in data:
                    new[key] = integer(data[key], key, 1, maximum)
            if new['startsPerIpHour'] < new['startsPerHour']:
                fail(400, 'invalid_limits', 'Лимит сети должен быть не меньше лимита одного пилота.')
            if 'maintenanceMessage' in data:
                new['maintenanceMessage'] = text_field(data['maintenanceMessage'], 'сообщение', 200, True)
            new.update(version=old['version'] + 1, updatedAt=stamp(now))
            tx.put('game_settings', 'main', new, now + 3650 * DAY)
            self.app.audit(tx, now, 'game.settings', 'game_settings', 'main',
                           {'before': old, 'after': new})
            return new
        return self.app.atomic(change, now)

    def profiles(self, request, now):
        if request.method != 'GET':
            fail(405, 'method_not_allowed', 'Метод не поддерживается.')
        query = str(request.query.get('q', '')).strip().casefold().lstrip('@')[:120]
        digits = re.sub(r'\D', '', query)
        def read(tx):
            users = {u['guestId']: u for u in self.app.scan(tx, 'members')}
            guests = {g['id']: g for g in self.app.scan(tx, 'guests')}
            for gid, u in users.items():
                guests.setdefault(gid, {'id': gid, 'name': u['name'], 'phone': u.get('phone', ''), 'status': 'inactive'})
            rows = []
            for gid, guest in guests.items():
                user = users.get(gid)
                row = {'guestId': gid, 'userId': user['id'] if user else None,
                       'username': user['username'] if user else '', 'name': guest['name'],
                       'phone': guest.get('phone') or (user or {}).get('phone', ''),
                       'email': guest.get('email', ''), 'status': guest.get('status', 'active'),
                       'disabled': bool((user or {}).get('disabled')), 'createdAt': guest.get('createdAt', '')}
                if not query or any(query in str(row[k] or '').casefold() for k in ('guestId', 'userId', 'username', 'name', 'phone', 'email')) or (len(digits) >= 3 and digits[-10:] in re.sub(r'\D', '', row['phone'])):
                    rows.append(row)
            rows.sort(key=lambda r: (r['username'] or r['name']).casefold())
            return self.app.paginate(rows, request)
        return self.app.atomic(read, now)

    def profile(self, request, now, guest_id):
        identifier(guest_id)
        if request.method != 'GET':
            fail(405, 'method_not_allowed', 'Метод не поддерживается.')
        def read(tx):
            guest = tx.get('guests', guest_id)
            if not guest:
                fail(404, 'not_found', 'Карточка гостя не найдена.')
            user = tx.get('members', guest.get('_memberId', '')) if guest.get('_memberId') else None
            bookings = [public_record(b) for b in self.app.scan(tx, 'bookings') if b.get('guestId') == guest_id]
            bookings.sort(key=lambda b: b['startsAt'], reverse=True)
            payload = {'smartshell': self.app.smartshell.profile(tx, guest_id), 'guest': public_record(guest), 'user': None, 'bookings': bookings[:200],
                       'bookingsTruncated': len(bookings) > 200,
                       'completedVisits': sum(b['status'] == 'completed' for b in bookings),
                       'completedValueRub': sum(b['priceRub'] for b in bookings if b['status'] == 'completed')}
            if user:
                history = self.app.scan(tx, 'game_history:' + user['id'])
                attempts = [a for a in self.app.scan(tx, 'game_attempts') if a.get('owner') == user['id']]
                reviews = [r for r in self.app.scan(tx, 'game_reviews') if r['userId'] == user['id']]
                errors = tx.get('game_start_errors', user['id'])
                history.sort(key=lambda r: r['createdAt'], reverse=True)
                attempts.sort(key=lambda r: r['started'], reverse=True)
                reviews.sort(key=lambda r: r['createdAt'], reverse=True)
                scores = self.app.game.leaders(tx, 'pro', True, True)
                visible_ranks = {r['userId']: i + 1 for i, r in enumerate(r for r in scores if not r['hidden'])}
                score = next((dict(r, rank=visible_ranks.get(user['id'])) for r in scores if r['userId'] == user['id']), None)
                payload.update(user={k: user.get(k) for k in ('id', 'username', 'name', 'phone', 'createdAt', 'updatedAt', 'registrationSource', 'disabled')},
                    history=history[:100], historyTruncated=len(history)>100,
                    attempts=[{k:a.get(k) for k in ('id','startedAt','status','timeMs','errorCode','errorMessage','finishedAt')} for a in attempts[:100]],
                    attemptsTruncated=len(attempts)>100, reviews=reviews[:100], startError=errors,
                    gameStats={'savedRuns':len(history), 'savedTimeMs':sum(r['timeMs'] for r in history),
                               'recordedStarts':len(attempts), 'verifiedFinishes':sum(a.get('status') in {'verified','saved'} for a in attempts),
                               'verifiedTimeMs':sum(a.get('timeMs',0) for a in attempts if a.get('status') in {'verified','saved'})},
                    best=score, reward=self.app.game.rewards.status(tx,user,now),
                    rewardHistory=[{k:r[k] for k in ('minutes','redeemedAt','week')} for r in self.app.scan(tx,'game_rewards') if r['userId']==user['id']])
            return payload
        return self.app.atomic(read, now)

    def start_error(self, user, error, now):
        if not user:
            return
        def record(tx):
            old = tx.get('game_start_errors', user['id']) or {}
            tx.put('game_start_errors', user['id'], {'code':error.code, 'message':error.message,
                'at':stamp(now), 'count':old.get('count',0)+1}, now+30*DAY)
        self.app.atomic(record, now)

    def submit_review(self, request, now):
        session, user = self.app.members.session(request, now)
        self.app.csrf(request, session)
        data = request.body()
        fields(data, {'requestId','token','timeMs','samples','season','comment'})
        request_id = identifier(data.get('requestId'))
        if data.get('season') != self.app.game.season:
            fail(409,'season_changed','Этот результат относится к другой трассе.')
        elapsed = integer(data.get('timeMs'), 'время', 20000, 600000)
        comment = text_field(data.get('comment',''), 'комментарий', 500)
        token = data.get('token')
        run_key = self.app.game.key(token) if token else None
        key = str(uuid.uuid5(uuid.NAMESPACE_URL, user['id']+':'+(run_key or request_id)))
        trace_status = 'not_provided'
        if data.get('samples'):
            from game import check_trace
            try:
                check_trace(data['samples'], elapsed)
                trace_status = 'plausible'
            except ApiError as error:
                trace_status = error.code
        def submit(tx):
            old = tx.get('game_reviews', key)
            if old:
                return old
            settings = self.settings(tx)
            if not settings['reviewsEnabled']:
                fail(503,'reviews_paused','Приём результатов на проверку временно закрыт. Свяжись с клубом.')
            if not self.app.rate(tx,'game-review:'+user['id'],now,settings['reviewsPerDay'],DAY):
                fail(429,'review_limit','Лимит обращений на сегодня исчерпан. Свяжись с клубом.')
            run = tx.get('game_runs',run_key) if run_key else None
            attempt = tx.get('game_attempts',run_key) if run_key else None
            owner = (run or attempt or {}).get('owner')
            if owner and owner != user['id']:
                fail(403,'run_owner','Этот заезд принадлежит другому профилю.')
            if run and run.get('savedBy'):
                fail(409,'already_saved','Этот заезд уже сохранён.')
            if run and run.get('registeredUser') and run['registeredUser'] != user['id']:
                fail(403,'run_owner','Этот заезд принадлежит другому профилю.')
            if run and not owner:
                run['owner']=user['id'];tx.put('game_runs',run_key,run,run['expires'])
            row={'id':key,'version':1,'userId':user['id'],'guestId':user['guestId'],
                 'username':user['username'],'timeMs':elapsed,'season':self.app.game.season,
                 'status':'pending','source':'member_claim','createdAt':stamp(now),'_createdEpoch':now,
                 'comment':comment,'traceCheck':trace_status,'serverStart':bool(run or attempt),
                 'reason':(attempt or {}).get('errorMessage','Пользователь просит проверить незачтённый результат.'),
                 'decisionNote':'','runKey':run_key}
            tx.put('game_reviews',key,row,now+365*DAY)
            self.app.audit(tx,now,'game.review.request','game_reviews',key,{'timeMs':elapsed},actor='member:'+user['id'])
            return row
        return self.app.atomic(submit,now)

    def reviews(self, request, now):
        if request.method == 'GET':
            def read(tx):
                rows=self.app.scan(tx,'game_reviews')
                state=request.query.get('status','pending')
                if state: rows=[r for r in rows if r['status']==state]
                rows.sort(key=lambda r:r['createdAt'],reverse=True)
                return self.app.paginate(rows,request)
            return self.app.atomic(read,now)
        data=request.body()
        if request.method == 'POST':
            fields(data,{'guestId','timeMs','reason','requestId'})
            guest_id=identifier(data.get('guestId'))
            key=identifier(data.get('requestId'))
            elapsed=integer(data.get('timeMs'),'время',20000,600000)
            reason=text_field(data.get('reason'),'основание',1000,True)
            def create(tx):
                old=tx.get('game_reviews',key)
                if old:
                    if old['guestId']!=guest_id or old['timeMs']!=elapsed: fail(409,'request_conflict','Идентификатор уже использован.')
                    return old
                guest=tx.get('guests',guest_id)
                user=tx.get('members',(guest or {}).get('_memberId',''))
                if not user or user.get('disabled'): fail(400,'profile_required','Нужен действующий профиль пилота.')
                row={'id':key,'version':1,'userId':user['id'],'guestId':guest_id,'username':user['username'],
                     'timeMs':elapsed,'season':self.app.game.season,'status':'pending','source':'admin_entry',
                     'createdAt':stamp(now),'_createdEpoch':now,'comment':'','reason':reason,
                     'traceCheck':'not_provided','serverStart':False,'decisionNote':''}
                tx.put('game_reviews',key,row,now+365*DAY)
                self.app.audit(tx,now,'game.review.create','game_reviews',key,{'timeMs':elapsed,'reason':reason})
                return row
            return self.app.atomic(create,now)
        if request.method != 'PATCH': fail(405,'method_not_allowed','Метод не поддерживается.')
        fields(data,{'id','version','decision','note'})
        key=identifier(data.get('id'))
        decision=data.get('decision')
        if decision not in {'approved','rejected'}: fail(400,'invalid_decision','Выбери решение.')
        note=text_field(data.get('note'),'основание решения',1000,True)
        def decide(tx):
            row=tx.get('game_reviews',key)
            if not row: fail(404,'not_found','Обращение не найдено.')
            if row['status']==decision and row.get('decisionNote')==note: return row
            self.app.check_version(data,row)
            if row['status']!='pending': fail(409,'already_reviewed','Результат уже рассмотрен.')
            if decision=='approved':
                if row['season']!=self.app.game.season: fail(409,'season_changed','Нельзя зачесть время другой трассы.')
                user=tx.get('members',row['userId'])
                if not user or user.get('disabled'): fail(409,'profile_unavailable','Профиль недоступен.')
                run=tx.get('game_runs',row.get('runKey','')) if row.get('runKey') else None
                if run and run.get('savedBy'): fail(409,'already_saved','Этот заезд уже сохранён обычным способом.')
                self.app.game.rewards.sync(tx,now)
                score_key=row['season']+':pro:'+row['userId']
                record={'id':row['id'],'username':row['username'],'userId':row['userId'],'board':'pro',
                        'timeMs':row['timeMs'],'createdAt':stamp(now),'season':row['season'],
                        'key':score_key,'source':'admin_review','reviewId':row['id']}
                old=tx.get('game_scores',score_key)
                if not old or record['timeMs']<old['timeMs']: tx.put('game_scores',score_key,record,now+365*DAY)
                tx.put('game_history:'+user['id'],record['id'],dict(self.app.game.score(record),season=row['season'],source='admin_review'),now+365*DAY)
                if run:
                    run.update(savedBy=user['id'],result=record,personalBest=not old or record['timeMs']<old['timeMs'])
                    tx.put('game_runs',row['runKey'],run,run['expires'])
                self.app.game.rewards.sync(tx,now)
            row.update(status=decision,decisionNote=note,reviewedAt=stamp(now),version=row['version']+1)
            tx.put('game_reviews',key,row,now+365*DAY)
            self.app.audit(tx,now,'game.review.'+decision,'game_reviews',key,{'username':row['username'],'timeMs':row['timeMs'],'note':note})
            return row
        return self.app.atomic(decide,now)
