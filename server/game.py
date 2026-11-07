"""Browser time trial, season 2. Plausibility checks, not authoritative physics.

Only an explicit authenticated save publishes the account's username. Anonymous
run receipts expire after one day; race telemetry is checked then discarded.
"""
import math
import re
import secrets
import uuid
from app import DAY, ApiError, fail, fields, stamp, flag
from game_track import POINTS, LENGTH, FINISH
from rewards import Rewards

SEASON = 'e60-sector-2'
TOKEN = re.compile(r'^[A-Za-z0-9_-]{43}$')
BOARDS = {'pro'}


def projection(x, z):
    best = (float('inf'), 0)
    for i, (a, b) in enumerate(zip(POINTS, POINTS[1:])):
        dx, dz = b[0] - a[0], b[1] - a[1]
        f = max(0, min(1, ((x-a[0])*dx + (z-a[1])*dz) / max(.001, dx*dx+dz*dz)))
        d = math.hypot(x-a[0]-f*dx, z-a[1]-f*dz)
        if d < best[0]:
            best = (d, (i+f)/(len(POINTS)-1))
    return best


def check_trace(samples, elapsed):
    if not isinstance(samples, list) or not 10 <= len(samples) <= 602:
        fail(400, 'invalid_trace', 'Не хватает данных прохождения. Попробуй новый заезд.')
    last = None
    progress = []
    for row in samples:
        if not isinstance(row, list) or len(row) != 3 or any(type(v) is not int for v in row):
            fail(400, 'invalid_trace', 'Некорректные данные заезда.')
        ms, x10, z10 = row
        if not 0 <= ms <= 600000 or abs(x10) > 30000 or abs(z10) > 30000:
            fail(400, 'invalid_trace', 'Данные заезда вне допустимого диапазона.')
        distance, t = projection(x10/10, z10/10)
        if distance > 6.3:
            fail(422, 'track_limits', 'Выезд за пределы зачётной трассы. Начни новый заезд для рейтинга.')
        if last:
            dt = (ms-last[0])/1000
            travelled = math.hypot(x10-last[1], z10-last[2])/10
            if not 0 < dt <= 1.1 or travelled > 72*dt+.4 or (t-progress[-1])*LENGTH > 73*dt+2:
                fail(422, 'invalid_motion', 'Заезд не прошёл проверку непрерывности движения.')
        last = row
        progress.append(t)
    if samples[0][0] != 0 or abs(progress[0]-.009) > .003 or abs(samples[-1][0]-elapsed) > 2:
        fail(422, 'invalid_start', 'Не удалось подтвердить старт и время заезда.')
    if not FINISH-.001 <= progress[-1] <= FINISH+.003:
        fail(422, 'missing_finish', 'Финишная линия не пройдена.')
    # Every segment must be traversed; samples cannot teleport across checkpoints.
    for gate in (.1, .2, .3, .4, .5, .6, .7, .8, .9):
        if not any(a <= gate <= b for a, b in zip(progress, progress[1:])):
            fail(422, 'missing_checkpoint', 'Пропущена часть трассы.')


class Game:
    def __init__(self, app):
        self.app = app
        self.season = SEASON
        self.rewards = Rewards(self)

    def key(self, token):
        if not isinstance(token, str) or not TOKEN.fullmatch(token):
            fail(400, 'invalid_run', 'Не найден код заезда. Начни новый заезд.')
        return self.app.digest('game:' + token)

    def limited(self, request, now, action, maximum, window=3600):
        key = self.app.digest('game-limit:' + action + ':' + (request.ip or 'unknown'))
        allowed = self.app.atomic(lambda tx: self.app.rate(tx, key, now, maximum, window), now)
        if not allowed:
            fail(429, 'rate_limited', 'Слишком много попыток. Подожди перед новым заездом.')

    @staticmethod
    def score(row):
        return {k: row[k] for k in ('id', 'username', 'board', 'timeMs', 'createdAt')}

    def leaders(self, tx, board, include_hidden=False, internal=False):
        rows = self.app.scan(tx, 'game_scores')
        result = []
        for row in rows:
            if row['season'] != SEASON or row['board'] != board:
                continue
            user = tx.get('members', row['userId'])
            hidden = bool(tx.get('game_hidden', row['key']))
            if user and not user.get('disabled') and (include_hidden or not hidden):
                result.append(dict(self.score(row), **({'key': row['key'], 'hidden': hidden} if include_hidden else {}), **({'userId': user['id'], 'guestId': user['guestId']} if internal else {})))
        result.sort(key=lambda r: (r['timeMs'], r['createdAt'], r['id']))
        return [dict(row, rank=i+1) for i, row in enumerate(result)]

    def attribute_registration(self, tx, token, user, now):
        if not token:
            return
        # Attribution is a completed server-issued run, not an arbitrary URL tag.
        row = tx.get('game_runs', self.key(token))
        if not row or not row.get('result') or row.get('registeredUser') or row.get('owner') or row.get('savedBy'):
            return
        row['registeredUser'] = user['id']
        tx.put('game_runs', self.key(token), row, row['expires'])
        user['registrationSource'] = 'mini_game'
        tx.put('game_registrations', user['id'], {'userId': user['id'], 'username': user['username'],
               'createdAt': stamp(now), 'board': row['board'], '_createdEpoch': now}, now+365*DAY)

    def saved_result(self, tx, row, user, now):
        # Re-evaluate even an idempotent save: another pilot may have taken P1.
        rank = None
        reward = None
        if row['board'] == 'pro':
            rank = next((r['rank'] for r in self.leaders(tx, 'pro', internal=True)
                         if r['userId'] == user['id']), None)
            reward = self.rewards.status(tx, user, now)
        return {'saved': True, 'result': row['result'], 'personalBest': row['personalBest'],
                'rank': rank, 'reward': reward}

    def handle(self, request, now):
        route = request.path[len('/api/game/'):]
        if request.method == 'GET' and route == 'leaders':
            board = 'pro'
            rows = self.app.atomic(lambda tx: self.leaders(tx, board), now)
            return self.app.response(request, 200, {'season': SEASON, 'board': board, 'items': rows[:50], 'total': len(rows)})
        if request.method == 'GET' and route == 'me':
            _, user = self.app.members.session(request, now)
            def read(tx):
                history = self.app.scan(tx, 'game_history:' + user['id'])
                history.sort(key=lambda r: r['createdAt'], reverse=True)
                best = []
                for board in ('pro',):
                    score = next((r for r in self.leaders(tx, board) if r['username'] == user['username']), None)
                    if score:
                        best.append(score)
                reviews=[{k:r.get(k) for k in ('id','timeMs','status','createdAt','reason','decisionNote','reviewedAt')} for r in self.app.scan(tx,'game_reviews') if r['userId']==user['id']]
                reviews.sort(key=lambda r:r['createdAt'],reverse=True)
                return {'best': best, 'history': history[:30], 'historyTruncated': len(history) > 30, 'season': SEASON, 'reviews':reviews[:30],
                        'reward': self.rewards.status(tx, user, now)}
            return self.app.response(request, 200, self.app.atomic(read, now))
        if request.method == 'POST' and route == 'review':
            return self.app.response(request,200,self.app.club_admin.submit_review(request,now))
        if request.method != 'POST' or route not in {'start', 'finish', 'save'}:
            fail(404, 'not_found', 'Ресурс не найден.')
        self.app.check_origin(request, required=True)
        data = request.body()
        if route == 'start':
            fields(data, {'board', 'season'})
            if data.get('season') != SEASON:
                fail(409, 'season_changed', 'Новая трасса: обнови страницу и начни заезд заново.')
            board = data.get('board')
            if not isinstance(board, str) or board not in BOARDS:
                fail(400, 'invalid_board', 'Доступен единый рейтинговый режим. Обнови страницу.')
            member = self.app.members.session(request, now, required=False)
            settings=self.app.atomic(self.app.club_admin.settings,now)
            try:
                if not settings['enabled']: fail(503,'game_paused',settings['maintenanceMessage'])
                identity='member:'+member[1]['id'] if member else 'ip:'+(request.ip or 'unknown')
                def reserve(tx):
                    pilot=self.app.digest('game-start-v16:'+identity)
                    network=self.app.digest('game-network-v16:'+(request.ip or 'unknown'))
                    if not self.app.rate_available(tx,pilot,now,settings['startsPerHour']) or not self.app.rate_available(tx,network,now,settings['startsPerIpHour']):
                        return False
                    self.app.rate(tx,pilot,now,settings['startsPerHour'],3600)
                    self.app.rate(tx,network,now,settings['startsPerIpHour'],3600)
                    return True
                if not self.app.atomic(reserve,now): fail(429,'start_limit','Лимит стартов за час исчерпан. Попробуй позже или свяжись с клубом.')
            except ApiError as error:
                self.app.club_admin.start_error(member[1] if member else None,error,now)
                raise
            token = secrets.token_urlsafe(32)
            row = {'board': board, 'season': SEASON, 'started': now, 'expires': now+7200,
                   'owner': member[1]['id'] if member else None, '_createdEpoch': now}
            def issue(tx):
                key=self.key(token)
                tx.put('game_runs',key,row,row['expires'])
                tx.put('game_attempts',key,dict(row,id=str(uuid.uuid4()),startedAt=stamp(now),status='started'),now+30*DAY)
            self.app.atomic(issue, now)
            return self.app.response(request, 201, {'token': token, 'season': SEASON})
        if route == 'finish':
            fields(data, {'token', 'timeMs', 'samples'})
            key = self.key(data.get('token'))
            elapsed = data.get('timeMs')
            if type(elapsed) is not int or not 20000 <= elapsed <= 600000:
                fail(422, 'invalid_time', 'В рейтинг принимаются заезды длительностью до 10 минут.')
            settings=self.app.atomic(self.app.club_admin.settings,now)
            self.limited(request, now, 'finish', settings['finishesPerHour'])
            def finish(tx):
                row = tx.get('game_runs', key)
                if not row:
                    fail(410, 'expired_run', 'Срок заезда истёк. Попробуй снова.')
                if row['season'] != SEASON:
                    fail(409, 'season_changed', 'Этот заезд из предыдущего сезона. Обнови страницу.')
                if row.get('result'):
                    if row['result']['timeMs'] != elapsed:
                        fail(409, 'finished_run', 'Этот результат уже зафиксирован.')
                    return dict(row['result'], expiresAt=stamp(row['expires']))
                if elapsed > (now-row['started']+3)*1000:
                    fail(422, 'invalid_clock', 'Не удалось подтвердить длительность заезда.')
                check_trace(data.get('samples'), elapsed)
                result = {'id': str(uuid.uuid4()), 'board': row['board'], 'timeMs': elapsed,
                          'createdAt': stamp(now), 'season': SEASON}
                row.update(result=result, expires=now+DAY)
                tx.put('game_runs', key, row, row['expires'])
                attempt=tx.get('game_attempts',key)
                if attempt:
                    attempt.update(status='verified',timeMs=elapsed,finishedAt=stamp(now))
                    tx.put('game_attempts',key,attempt,now+30*DAY)
                return dict(result, expiresAt=stamp(row['expires']))
            try:
                verified=self.app.atomic(finish,now)
            except ApiError as error:
                def rejected(tx):
                    attempt=tx.get('game_attempts',key)
                    if attempt and attempt['status'] not in {'verified','saved'}:
                        attempt.update(status='rejected',timeMs=elapsed,errorCode=error.code,errorMessage=error.message,finishedAt=stamp(now))
                        tx.put('game_attempts',key,attempt,now+30*DAY)
                self.app.atomic(rejected,now)
                raise
            return self.app.response(request, 200, verified)
        fields(data, {'token', 'publish'})
        flag(data.get('publish'), 'публикация')
        session, user = self.app.members.session(request, now)
        self.app.csrf(request, session)
        key = self.key(data.get('token'))
        self.limited(request, now, 'save', 80)
        def save(tx):
            row = tx.get('game_runs', key)
            if not row or not row.get('result'):
                fail(410, 'expired_run', 'Срок сохранения истёк. Начни новый заезд.')
            if row['season'] != SEASON:
                fail(409, 'season_changed', 'Результат старой трассы нельзя добавить в новый сезон.')
            if row['board'] == 'pro' and data['publish'] is not True:
                fail(400, 'publication_required', 'Подтверди публикацию позывного и времени.')
            if (row.get('owner') and row['owner'] != user['id']) or (row.get('registeredUser') and row['registeredUser'] != user['id']):
                fail(403, 'run_owner', 'Этот заезд принадлежит другому профилю.')
            if row.get('savedBy') and row['savedBy'] != user['id']:
                fail(409, 'already_saved', 'Результат уже сохранён другим пилотом.')
            if row.get('savedBy'):
                return self.saved_result(tx, row, user, now)
            review_id=str(uuid.uuid5(uuid.NAMESPACE_URL,user['id']+':'+key))
            review=tx.get('game_reviews',review_id)
            if review and review['status']=='approved': fail(409,'already_reviewed','Этот результат уже зачтён администратором.')
            self.rewards.sync(tx, now)
            record = dict(row['result'], username=user['username'], userId=user['id'])
            record['season'] = SEASON
            score_key = SEASON + ':' + row['board'] + ':' + user['id']
            record['key'] = score_key
            old = tx.get('game_scores', score_key)
            better = not old or record['timeMs'] < old['timeMs']
            if better and row['board'] == 'pro':
                tx.put('game_scores', score_key, record, now+365*DAY)
            self.rewards.sync(tx, now)
            tx.put('game_history:'+user['id'], record['id'], dict(self.score(record), season=SEASON), now+365*DAY)
            row.update(savedBy=user['id'], personalBest=better)
            tx.put('game_runs', key, row, row['expires'])
            attempt=tx.get('game_attempts',key)
            if attempt:
                attempt.update(owner=user['id'],status='saved',timeMs=record['timeMs'])
                tx.put('game_attempts',key,attempt,now+30*DAY)
            if review and review['status']=='pending':
                review.update(status='resolved',decisionNote='Сохранён обычным способом.',version=review['version']+1,reviewedAt=stamp(now))
                tx.put('game_reviews',review_id,review,now+365*DAY)
            self.app.audit(tx, now, 'game.save', 'game_results', record['id'],
                           {'board': row['board'], 'timeMs': record['timeMs']}, actor='member:'+user['id'])
            return self.saved_result(tx, row, user, now)
        return self.app.response(request, 200, self.app.atomic(save, now))

    def admin(self, request, now):
        if request.method == 'PATCH':
            data = request.body()
            fields(data, {'key', 'hidden'})
            key, hidden = data.get('key'), flag(data.get('hidden'), 'видимость')
            if not isinstance(key, str) or not re.fullmatch(rf'{SEASON}:(novice|pro):[a-f0-9-]{{36}}', key):
                fail(400, 'invalid_score', 'Не найден результат.')
            def moderate(tx):
                row = tx.get('game_scores', key)
                if not row:
                    fail(404, 'not_found', 'Результат не найден.')
                self.rewards.sync(tx, now)
                if hidden:
                    tx.put('game_hidden', key, {'hidden': True}, now+365*DAY)
                else:
                    tx.delete('game_hidden', key)
                self.rewards.sync(tx, now)
                self.app.audit(tx, now, 'game.hide' if hidden else 'game.restore', 'game_scores', row['id'])
                return {'ok': True}
            return self.app.atomic(moderate, now)
        if request.method != 'GET':
            fail(405, 'method_not_allowed', 'Метод не поддерживается.')
        since, until, period = self.app.period(request, now)
        def report(tx):
            registrations = self.app.scan(tx, 'game_registrations', since, until)
            registrations.sort(key=lambda r: r['createdAt'], reverse=True)
            scores = self.leaders(tx, 'pro', True, internal=True)
            redeemed = self.app.scan(tx, 'game_rewards', since, until)
            return {'period': period, 'registrations': [{k: r[k] for k in ('username', 'createdAt', 'board')} for r in registrations],
                    'registrationCount': len(registrations), 'scores': scores,
                    'racers': len({r['username'] for r in scores}), 'season': SEASON,
                    'redeemedHours': len(redeemed), 'redemptions': [{k:r[k] for k in ('username','guestId','minutes','redeemedAt')} for r in sorted(redeemed,key=lambda r:r['redeemedAt'],reverse=True)]}
        return self.app.atomic(report, now)
