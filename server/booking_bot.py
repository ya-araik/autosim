"""Private outbox and owner-only decisions for the existing Telegram notification bot."""
import hmac
import re
import secrets
from datetime import datetime, timezone

from app import DAY, CRM_DAYS, fields, integer, text_field, fail, stamp, parse_instant
from member import safe_booking


class BookingBot:
    def __init__(self, app):
        self.app = app

    def authorize(self, request):
        secret = self.app.config.booking_secret
        owner = self.app.config.booking_owner_id
        if len(secret) < 32 or not re.fullmatch(r'[1-9]\d{4,19}', owner):
            fail(503, 'booking_channel_unavailable', 'Канал заявок ещё не настроен.')
        supplied = request.headers.get('x-autosim-booking-secret', '')
        if len(supplied) > 200 or not hmac.compare_digest(supplied, secret):
            fail(403, 'channel_denied', 'Доступ запрещён.')
        if request.method != 'POST':
            fail(405, 'method_not_allowed', 'Метод не поддерживается.')

    def owners(self, tx):
        primary = self.app.config.booking_owner_id
        secondary = tx.get('booking_owners', 'secondary')
        return [primary] + ([secondary['id']] if secondary and secondary['id'] != primary else [])

    def delivery_key(self, booking_id, owner_id):
        return booking_id if owner_id == self.app.config.booking_owner_id else booking_id + ':' + owner_id

    def register_owners(self, data, now):
        # The authenticated adapter reads ONLY permanent owner slots 101/102 in
        # the existing bot database. Staff members and group chats are excluded.
        fields(data, {'ownerIds'})
        ids = data.get('ownerIds')
        if (not isinstance(ids, list) or not 1 <= len(ids) <= 2 or len(set(str(v) for v in ids)) != len(ids)
                or any(not isinstance(v, str) or not re.fullmatch(r'[1-9]\d{4,19}', v) for v in ids)
                or self.app.config.booking_owner_id not in ids):
            fail(403, 'invalid_owners', 'Не удалось проверить владельцев бота.')
        def register(tx):
            others = [v for v in ids if v != self.app.config.booking_owner_id]
            if others:
                old = tx.get('booking_owners', 'secondary')
                if old and old['id'] != others[0]:
                    fail(409, 'owner_pinned', 'Владелец уже закреплён за другим Telegram ID.')
                if not old:
                    tx.put('booking_owners', 'secondary', {'id': others[0], 'username': 'owner',
                           '_createdEpoch': now}, 9999999999)
                    # Give the new owner the active queue, without re-notifying the primary owner.
                    for booking in self.app.scan(tx, 'bookings'):
                        if (booking.get('_memberId') and booking.get('source') == 'website'
                                and booking['status'] in {'draft', 'confirmed'}
                                and parse_instant(booking['endsAt']).timestamp() > now):
                            guest = tx.get('guests', booking.get('guestId') or '') or {}
                            if not guest.get('_ssFixture'):
                                self.app.members.queue_notification(tx, booking, others[0], now)
                    self.app.audit(tx, now, 'booking.owner_activated', details={'username': 'owner'}, actor='booking-bot')
            return {'ok': True, 'ownerCount': len(self.owners(tx))}
        return self.app.atomic(register, now)

    def owner(self, data, now):
        actor = data.get('actorId')
        owners = self.app.atomic(self.owners, now)
        if not isinstance(actor, str) or not any(hmac.compare_digest(actor, value) for value in owners):
            fail(403, 'owner_required', 'Управление заявками доступно только владельцам.')
        return actor

    def card(self, record, owner_id=None):
        value = safe_booking(record)
        value.update(guestName=record['guestName'], phone=record['phone'], comment=record.get('notes', ''),
                     proposal=record.get('proposal'), ownerId=owner_id or self.app.config.booking_owner_id,
                     allocationMessage=record.get('allocationMessage',''))
        return value

    def booking(self, tx, data):
        record_id = data.get('id', '')
        if not isinstance(record_id, str) or not re.fullmatch(r'[a-f0-9-]{36}', record_id):
            fail(400, 'invalid_id', 'Некорректная заявка.')
        booking = tx.get('bookings', record_id)
        if not booking or booking.get('source') != 'website' or not booking.get('_memberId'):
            fail(404, 'not_found', 'Заявка не найдена.')
        return booking

    def delivery_status(self, tx, booking, now, owner_id=None):
        owner_id = owner_id or self.app.config.booking_owner_id
        key = self.delivery_key(booking['id'], owner_id)
        job = tx.get('booking_notifications', key) or {}
        receipt = tx.get('booking_delivery', key) or {}
        guest = tx.get('guests', booking.get('guestId') or '') or {}
        pulse = tx.get('integration_health', 'booking_bot') or {}
        return {'state': job.get('state', 'missing'), 'attempts': job.get('attempts', 0),
                'queuedAt': job.get('createdAt'), 'deliveredAt': stamp(receipt['_createdEpoch']) if receipt else None,
                'messageId': receipt.get('messageId'), 'deliveredVersion': receipt.get('version'),
                'recipientMatches': receipt.get('ownerId') == owner_id if receipt else None,
                'lastPoll': pulse.get('lastPoll'), 'testFixture': bool(guest.get('_ssFixture')),
                'retryPending': bool(job.get('forceNew')), 'lastRequestedAt': job.get('lastRequestedAt'),
                'username': 'owner' if owner_id == self.app.config.booking_owner_id else 'co-owner'}

    def delivery_endpoint(self, request, session, record_id, now):
        if request.method not in {'GET', 'POST'}:
            fail(405, 'method_not_allowed', 'Метод не поддерживается.')
        data = request.body() if request.method == 'POST' else {}
        if request.method == 'POST':
            self.app.access.require(session, 'owner')
            fields(data, {'version'})
        def run(tx):
            booking = self.booking(tx, {'id': record_id})
            if request.method == 'POST':
                self.app.check_version(data, booking)
                guest = tx.get('guests', booking.get('guestId') or '') or {}
                if guest.get('_ssFixture'):
                    fail(409, 'test_fixture', 'Для автоматического тестового профиля уведомления отключены.')
                if len(self.app.config.booking_secret) < 32 or not self.app.config.booking_owner_id:
                    fail(503, 'booking_channel_unavailable', 'Канал заявок не настроен.')
                for owner_id in self.owners(tx):
                    key = self.delivery_key(record_id, owner_id)
                    job = tx.get('booking_notifications', key) or {}
                    if job.get('leaseUntil', 0) > now:
                        fail(409, 'delivery_in_progress', 'Уведомление уже отправляется. Обнови статус через минуту.')
                    if not (job.get('forceNew') and job.get('state') != 'sent'):
                        if job.get('_lastRequestedEpoch', 0) > now - 120:
                            fail(429, 'retry_limited', 'Повторная отправка доступна через две минуты.')
                        # No booking/SmartShell write; existing receipt is retained until success.
                        job.update(id=record_id, ownerId=owner_id, version=booking['version'], status=booking['status'],
                                   state='pending', attempts=0, leaseUntil=0, leaseToken='', nextAt=now,
                                   forceNew=True, lastRequestedAt=stamp(now), _lastRequestedEpoch=now)
                        job.setdefault('createdAt', stamp(now))
                        job.setdefault('_createdEpoch', now)
                        tx.put('booking_notifications', key, job, now + 30 * DAY)
                self.app.audit(tx, now, 'booking.notification_retry', 'bookings', record_id)
            result = self.delivery_status(tx, booking, now)
            result['recipients'] = [self.delivery_status(tx, booking, now, owner_id) for owner_id in self.owners(tx)]
            return result
        return self.app.atomic(run, now)

    def lease(self, now):
        lease_token = secrets.token_urlsafe(32)
        def take(tx):
            tx.put('integration_health', 'booking_bot', {'lastPoll': stamp(now), '_createdEpoch': now}, now + DAY)
            jobs = self.app.scan(tx, 'booking_notifications')
            jobs.sort(key=lambda row: row['nextAt'])
            owners = self.owners(tx)
            for job in jobs:
                if job['state'] == 'sent' or job['nextAt'] > now or job['leaseUntil'] > now:
                    continue
                owner_id = job.get('ownerId', self.app.config.booking_owner_id)
                if owner_id not in owners:
                    continue
                key = self.delivery_key(job['id'], owner_id)
                booking = tx.get('bookings', job['id'])
                if not booking or not booking.get('_memberId'):
                    tx.delete('booking_notifications', key)
                    continue
                receipt = tx.get('booking_delivery', key)
                cancellation = tx.get('booking_cancel_delivery', key) or {}
                job.update(leaseUntil=now + 90, leaseToken=lease_token, attempts=job['attempts'] + 1,
                           nextAt=now + min(1800, 60 * 2 ** min(job['attempts'], 5)))
                tx.put('booking_notifications', key, job, now + 30 * DAY)
                return {'job': {'id': job['id'], 'ownerId': owner_id, 'version': job['version'], 'leaseToken': lease_token,
                                'messageId': receipt.get('messageId') if receipt and not job.get('forceNew') else None,
                                'cancellationVersion': job.get('cancellationVersion', 0),
                                'cancellationMessageId': cancellation.get('messageId') if cancellation.get('version') == job.get('cancellationVersion') else None,
                                'card': self.card(booking, owner_id)}}
            return {'job': None}
        return self.app.atomic(take, now)

    def acknowledge(self, data, now):
        fields(data, {'id', 'version', 'leaseToken', 'messageId', 'ownerId'})
        message_id = integer(data.get('messageId'), 'messageId', 1, 2 ** 52)
        def ack(tx):
            booking = self.booking(tx, data)
            owner_id = data.get('ownerId', self.app.config.booking_owner_id)
            if owner_id not in self.owners(tx): fail(403, 'owner_required', 'Владелец не найден.')
            key = self.delivery_key(booking['id'], owner_id)
            job = tx.get('booking_notifications', key)
            if not job or data.get('version') != job['version'] or not isinstance(data.get('leaseToken'), str) or not hmac.compare_digest(data['leaseToken'], job.get('leaseToken', '')):
                fail(409, 'stale_delivery', 'Заявка уже изменилась.')
            previous = tx.get('booking_delivery', key)
            if previous and previous.get('messageId') != message_id:
                tx.put('booking_delivery_history', key + ':' + str(previous['messageId']), previous, now + CRM_DAYS * DAY)
            job.update(state='sent', leaseUntil=0, leaseToken='', forceNew=False)
            tx.put('booking_notifications', key, job, now + 30 * DAY)
            tx.put('booking_delivery', key, {'messageId': message_id, 'version': job['version'],
                   'ownerId': owner_id, '_createdEpoch': now}, now + CRM_DAYS * DAY)
            return {'ok': True}
        return self.app.atomic(ack, now)

    def acknowledge_cancellation(self, data, now):
        # Independent receipt survives an ordinary card edit or a newer queued version.
        fields(data, {'id', 'cancellationVersion', 'messageId', 'ownerId'})
        version = integer(data.get('cancellationVersion'), 'cancellationVersion', 1, 2 ** 31)
        message_id = integer(data.get('messageId'), 'messageId', 1, 2 ** 52)
        def ack(tx):
            booking = self.booking(tx, data)
            owner_id = data.get('ownerId', self.app.config.booking_owner_id)
            if owner_id not in self.owners(tx): fail(403, 'owner_required', 'Владелец не найден.')
            key = self.delivery_key(booking['id'], owner_id)
            if version > booking['version']:
                fail(409, 'stale_delivery', 'Некорректная версия отмены.')
            previous = tx.get('booking_cancel_delivery', key) or {}
            if previous.get('version', 0) < version:
                tx.put('booking_cancel_delivery', key, {'version': version, 'messageId': message_id,
                       '_createdEpoch': now}, now + CRM_DAYS * DAY)
            return {'ok': True}
        return self.app.atomic(ack, now)

    def action(self, data, now):
        fields(data, {'id', 'version', 'action', 'actorId'})
        actor = self.owner(data, now)
        action = data.get('action')
        if action not in {'confirm', 'reject', 'contact', 'refresh'}:
            fail(400, 'invalid_action', 'Действие неизвестно.')
        allocation = candidate = None
        if action == 'confirm':
            candidate = self.app.atomic(lambda tx: self.booking(tx, data), now)
            self.app.check_version(data, candidate)
            allocation = self.app.seats.preflight(candidate, now, candidate['id'])
        def mutate(tx):
            booking = self.booking(tx, data)
            if action == 'refresh':
                return {'card': self.card(booking, actor)}
            self.app.check_version(data, booking)
            if booking['status'] not in {'draft', 'confirmed'}:
                fail(409, 'closed_booking', 'Заявка уже закрыта. Обнови карточку.')
            if action == 'confirm':
                if booking.get('proposal'):
                    fail(409, 'proposal_pending', 'Гость ещё не согласовал предложенное время.')
                booking = self.app.validate_booking({'version': booking['version'], 'status': 'confirmed'}, now, booking)
                if allocation:
                    booking.update({k:candidate[k] for k in ('seatIds','seatLabels','_hostIds','allocationState')})
                    self.app.seats.price_selection(booking, booking['seatIds'])
                    self.app.seats.assert_free(tx, booking, *allocation, now, booking['id'])
                booking['ownerMessage'] = 'Клуб принял заявку. Актуальный статус записи указан выше.'
            elif action == 'reject':
                booking.update(status='cancelled', proposal=None, ownerMessage='К сожалению, выбранный заезд не удалось подтвердить. Позвони — подберём другой вариант.')
            else:
                booking['ownerMessage'] = 'Нужно уточнить детали. Владелец свяжется с тобой по указанному телефону.'
            booking.update(version=booking['version'] + 1, updatedAt=stamp(now))
            tx.put('bookings', booking['id'], booking, now + CRM_DAYS * DAY)
            self.app.members.queue(tx, booking, now)
            self.app.audit(tx, now, 'booking.owner_' + action, 'bookings', booking['id'], actor='telegram-owner:' + actor)
            return {'card': self.card(booking, actor)}
        result = self.app.atomic(mutate, now)
        if action in {'confirm','reject'}:
            self.app.smartshell.sync.kick('booking:'+result['card']['id'],now)
            result = self.app.atomic(lambda tx: {'card':self.card(self.booking(tx,data),actor)},now)
        return result

    def prompt(self, data, now):
        fields(data, {'id', 'version', 'actorId', 'promptId'})
        actor = self.owner(data, now)
        prompt_id = integer(data.get('promptId'), 'promptId', 1, 2 ** 52)
        def store(tx):
            booking = self.booking(tx, data)
            self.app.check_version(data, booking)
            if booking['status'] not in {'draft','confirmed'}:
                fail(409, 'closed_booking', 'Запись уже закрыта.')
            tx.put('booking_prompts', actor, {'id': booking['id'],
                   'version': booking['version'], 'promptId': prompt_id, '_createdEpoch': now}, now + 15 * 60)
            return {'ok': True}
        return self.app.atomic(store, now)

    def reply(self, data, now):
        fields(data, {'actorId', 'promptId', 'text'})
        actor = self.owner(data, now)
        prompt_id = integer(data.get('promptId'), 'promptId', 1, 2 ** 52)
        raw = text_field(data.get('text', ''), 'время', 80)
        # A proposal does not release the existing reservation. Check the new
        # time now, then check it again when the guest accepts it.
        proposed = None
        if raw.lower() not in {'отмена','/cancel'}:
            prompt = self.app.atomic(lambda tx: tx.get('booking_prompts',actor),now)
            if prompt and prompt['promptId']==prompt_id:
                proposed = self.app.atomic(lambda tx:self.booking(tx,prompt),now)
                self.app.check_version(prompt,proposed)
                match = re.fullmatch(r'(20\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2})',raw)
                if not match: fail(400,'invalid_time','Ответь датой и временем: 2026-09-26 18:00. Время Оренбурга.')
                proposed=self.app.validate_booking({'startsAt':match[1]+'T'+match[2]+':00+05:00'},now,proposed)
                instant=parse_instant(proposed['startsAt'])
                if not now+900<=instant.timestamp()<=now+90*DAY or instant.minute:
                    fail(400,'invalid_time','Выбери будущий сеанс с началом в ровный час.')
                self.app.seats._preflight(proposed,now,proposed['id'])
        def apply(tx):
            draft = tx.get('booking_prompts', actor)
            if not draft or draft['promptId'] != prompt_id:
                return {'handled': False}
            booking = self.booking(tx, draft)
            self.app.check_version(draft, booking)
            if booking['status'] not in {'draft','confirmed'}:
                fail(409, 'closed_booking', 'Заявка уже обработана.')
            if raw.lower() in {'отмена', '/cancel'}:
                tx.delete('booking_prompts', actor)
                return {'handled': True, 'cancelled': True}
            match = re.fullmatch(r'(20\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2})', raw)
            if not match:
                fail(400, 'invalid_time', 'Ответь датой и временем: 2026-09-20 18:00. Время Оренбурга. Или «отмена».')
            candidate = self.app.validate_booking({'startsAt': match[1] + 'T' + match[2] + ':00+05:00'}, now, booking)
            start = parse_instant(candidate['startsAt'])
            if not now + 900 <= start.timestamp() <= now + 90 * DAY or start.minute:
                fail(400, 'invalid_time', 'Выбери будущий сеанс с началом в ровный час.')
            booking.update(proposal={'startsAt': candidate['startsAt'], 'endsAt': candidate['endsAt']},
                           ownerMessage='Есть другое время. Если подходит, согласуй его в кабинете.',
                           version=booking['version'] + 1, updatedAt=stamp(now))
            tx.put('bookings', booking['id'], booking, now + CRM_DAYS * DAY)
            tx.delete('booking_prompts', actor)
            self.app.members.queue(tx, booking, now)
            self.app.audit(tx, now, 'booking.propose', 'bookings', booking['id'], actor='telegram-owner:' + actor)
            return {'handled': True, 'card': self.card(booking, actor)}
        return self.app.atomic(apply, now)

    def handle(self, request, now):
        self.authorize(request)
        data = request.body()
        route = request.path[len('/api/booking-bot/'):]
        if route == 'owners':
            result = self.register_owners(data, now)
        elif route == 'lease':
            fields(data, set())
            result = self.lease(now)
        elif route == 'ack':
            result = self.acknowledge(data, now)
        elif route == 'cancel-ack':
            result = self.acknowledge_cancellation(data, now)
        elif route == 'action':
            result = self.action(data, now)
        elif route == 'prompt':
            result = self.prompt(data, now)
        elif route == 'reply':
            result = self.reply(data, now)
        else:
            fail(404, 'not_found', 'Ресурс не найден.')
        return self.app.response(request, 200, result)
