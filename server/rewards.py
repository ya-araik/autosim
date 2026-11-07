"""A non-transferable leader hour; eligibility is checked atomically at redemption.

A leadership spell survives self-improvements. Losing and retaking P1 starts a
new spell. Each spell gets one hour per Orenburg calendar week; nothing accrues.
"""
import re
import uuid
from datetime import datetime, timedelta
from app import CLUB_TZ, DAY, fail, fields, stamp

CAMPAIGN = 'leader-hour-1'


def club_week(now):
    local = datetime.fromtimestamp(now, CLUB_TZ)
    start = (local - timedelta(days=local.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=7)
    return start.date().isoformat(), stamp(start.timestamp()), stamp(end.timestamp())


class Rewards:
    def __init__(self, game):
        self.game, self.app = game, game.app

    def sync(self, tx, now):
        rows = self.game.leaders(tx, 'pro', internal=True)
        leader = rows[0] if rows else None
        current = tx.get('game_leadership', CAMPAIGN)
        identity = leader['userId'] if leader else None
        if not current or current['userId'] != identity or current['season'] != self.game.season:
            current = {'userId': identity, 'season': self.game.season, 'epoch': str(uuid.uuid4()),
                       'since': stamp(now), '_createdEpoch': now}
            tx.put('game_leadership', CAMPAIGN, current, now+3650*DAY)
        return current

    def status(self, tx, user, now, state=None):
        state = state or self.sync(tx, now)
        week, starts, ends = club_week(now)
        key = ':'.join((CAMPAIGN, user['id'], state['epoch'], week))
        used = tx.get('game_rewards', key)
        leader = state['userId'] == user['id'] and not user.get('disabled')
        return {'campaign': CAMPAIGN, 'week': week, 'epoch': state['epoch'],
                'weekStartsAt': starts, 'resetsAt': ends, 'isLeader': leader,
                'available': leader and not used, 'minutes': 60 if leader and not used else 0,
                'redeemedAt': used['redeemedAt'] if leader and used else None,
                'state': 'available' if leader and not used else 'used' if leader else 'not_leader'}

    def admin(self, request, now):
        if request.method not in {'GET', 'POST'}:
            fail(405, 'method_not_allowed', 'Метод не поддерживается.')
        data = request.body() if request.method == 'POST' else {}
        if request.method == 'POST':
            fields(data, {'guestId', 'week', 'epoch'})
        guest_id = data.get('guestId') if data else request.query.get('guestId', '')
        if not isinstance(guest_id, str) or not re.fullmatch(r'[a-f0-9-]{36}', guest_id):
            fail(400, 'invalid_guest', 'Открой сохранённую карточку гостя.')

        def apply(tx):
            guest = tx.get('guests', guest_id)
            if not guest:
                fail(404, 'not_found', 'Карточка гостя не найдена.')
            user = tx.get('members', guest.get('_memberId', '')) if guest.get('_memberId') else None
            if not user:
                if request.method == 'POST':
                    fail(409, 'no_account', 'У этой карточки нет игрового профиля.')
                return {'linked': False}
            state = self.sync(tx, now)
            status = self.status(tx, user, now, state)
            if request.method == 'POST':
                if data.get('week') != status['week'] or data.get('epoch') != status['epoch']:
                    fail(409, 'reward_changed', 'Неделя или лидер изменились. Обнови карточку перед списанием.')
                if not status['isLeader']:
                    fail(409, 'not_leader', 'Рекорд уже побит. Бесплатный час сейчас недоступен.')
                if guest.get('status') != 'active':
                    fail(409, 'inactive_guest', 'Карточка гостя неактивна.')
                key = ':'.join((CAMPAIGN, user['id'], state['epoch'], status['week']))
                if not tx.get('game_rewards', key):
                    record = {'id': str(uuid.uuid4()), 'userId': user['id'], 'guestId': guest_id,
                              'username': user['username'], 'campaign': CAMPAIGN, 'epoch': state['epoch'],
                              'week': status['week'], 'minutes': 60, 'redeemedAt': stamp(now),
                              'createdAt': stamp(now), '_createdEpoch': now}
                    tx.put('game_rewards', key, record, now+365*DAY)
                    self.app.audit(tx, now, 'game.reward.redeem', 'guests', guest_id,
                                   {'minutes': 60, 'week': status['week'], 'epoch': state['epoch']})
                status = self.status(tx, user, now, state)
            history = [r for r in self.app.scan(tx, 'game_rewards') if r['userId'] == user['id']]
            history.sort(key=lambda r: r['redeemedAt'], reverse=True)
            return {'linked': True, 'username': user['username'], 'reward': status,
                    'history': [{k: r[k] for k in ('id', 'minutes', 'redeemedAt', 'week')} for r in history[:20]]}
        return self.app.atomic(apply, now)
