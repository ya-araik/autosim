"""Callback requests, durable Telegram delivery and the migrated lead workflow."""
import hashlib
import hmac
import json
import os
import re
import secrets
import uuid
from datetime import datetime

from app import DAY, CRM_DAYS, CLUB_TZ, fields, text_field, fail, stamp


class Leads:
    def __init__(self, app):
        self.app = app

    def save(self, tx, lead, now):
        lead['updatedAt'] = stamp(now)
        tx.put('leads', lead['id'], lead, now + CRM_DAYS * DAY)

    def queue(self, tx, lead, now):
        job = tx.get('lead_notifications', lead['id']) or {'id': lead['id'], '_createdEpoch': now}
        job.update(version=lead['version'], nextAt=now, state='pending')
        tx.put('lead_notifications', lead['id'], job, now + CRM_DAYS * DAY)

    def create(self, request, now):
        self.app.check_origin(request, required=True)
        data = request.body()
        fields(data, {'requestId', 'name', 'phone', 'message', 'source', 'consent'})
        request_id = data.get('requestId')
        if not isinstance(request_id, str) or not re.fullmatch(r'[a-f0-9-]{36}', request_id):
            fail(400, 'invalid_request', 'Обнови страницу и попробуй ещё раз.')
        name = text_field(data.get('name'), 'Имя', 100, required=True)
        raw_phone = text_field(data.get('phone'), 'Телефон', 32, required=True)
        if re.search(r'[^\d\s()+-]', raw_phone):
            fail(400, 'invalid_phone', 'Укажи телефон в формате +7 (999) 000-00-00.')
        phone = re.sub(r'\D', '', raw_phone)
        if len(phone) == 11 and phone[0] == '8': phone = '7' + phone[1:]
        if not re.fullmatch(r'7\d{10}', phone):
            fail(400, 'invalid_phone', 'Укажи телефон в формате +7 (999) 000-00-00.')
        message = text_field(data.get('message', ''), 'Пожелания', 1200)
        source = text_field(data.get('source', 'Главная страница'), 'Источник', 600)
        if data.get('consent') is not True:
            fail(400, 'consent_required', 'Подтверди согласие на обработку заявки.')
        fingerprint = hashlib.sha256(json.dumps([name, phone, message, source], ensure_ascii=False).encode()).hexdigest()
        def create(tx):
            previous = tx.get('lead_requests', request_id)
            if previous:
                if previous['fingerprint'] != fingerprint:
                    fail(409, 'request_conflict', 'Эта заявка уже отправлена. Для новой обнови страницу.')
                return {'id': previous['id'], 'accepted': True}
            if not self.app.rate_available(tx, 'leads:global', now, 100):
                fail(429, 'rate_limited', 'Слишком много заявок. Попробуй позже или позвони.')
            if not self.app.rate(tx, 'leads:ip:' + self.app.digest(request.ip or 'unknown'), now, 5, 900):
                fail(429, 'rate_limited', 'Попробуй через несколько минут или позвони в клуб.')
            self.app.rate(tx, 'leads:global', now, 100, 900)
            counter = tx.get('counters', 'leads') or {'value': 0}
            counter['value'] += 1
            tx.put('counters', 'leads', counter, 9999999999)
            lead = {'id': str(uuid.uuid4()), 'leadNumber': counter['value'], 'name': name,
                    'phone': '+' + phone, 'message': message, 'source': source, 'status': 'new',
                    'version': 1, 'createdAt': stamp(now), '_createdEpoch': now, 'reminders': []}
            self.save(tx, lead, now)
            self.queue(tx, lead, now)
            tx.put('lead_requests', request_id, {'id': lead['id'], 'fingerprint': fingerprint}, now + CRM_DAYS * DAY)
            return {'id': lead['id'], 'accepted': True}
        return self.app.atomic(create, now)

    def webhook(self, request, now):
        secret = os.environ.get('TELEGRAM_WEBHOOK_SECRET', '')
        supplied = request.headers.get('x-telegram-bot-api-secret-token', '')
        if len(secret) < 32 or not hmac.compare_digest(secret, supplied):
            fail(401, 'webhook_denied', 'Доступ запрещён.')
        if os.environ.get('TELEGRAM_UPDATE_MODE') != 'webhook':
            fail(503, 'webhook_disabled', 'Webhook не включён.')
        data = request.body()
        update_id = data.get('update_id')
        if isinstance(update_id, bool) or not isinstance(update_id, int) or not 0 <= update_id < 2**53:
            fail(400, 'invalid_update', 'Некорректное обновление.')
        for key in ('message', 'callback_query'):
            if key in data and not isinstance(data[key], dict): fail(400, 'invalid_update', 'Некорректное обновление.')
        def enqueue(tx):
            key = str(update_id)
            if not tx.get('telegram_updates', key):
                tx.put('telegram_updates', key, {'id': key, 'update': data, 'state': 'pending', '_createdEpoch': now}, now + 7 * DAY)
        self.app.atomic(enqueue, now)
        return {'ok': True}

    def process_webhooks(self, handle, now):
        lease = secrets.token_urlsafe(24)
        def reserve(tx):
            rows = sorted(self.app.scan(tx, 'telegram_updates'), key=lambda row: int(row['id']))
            for row in rows:
                if row['state'] == 'sent': continue
                if row.get('leaseUntil', 0) > now: return
                row.update(lease=lease, leaseUntil=now + 90)
                tx.put('telegram_updates', row['id'], row, now + 7 * DAY)
                return row
        row = self.app.atomic(reserve, now)
        if not row: return False
        handle(row['update'])
        def ack(tx):
            current = tx.get('telegram_updates', row['id'])
            if current and current.get('lease') == lease:
                current.update(state='sent', leaseUntil=0)
                tx.put('telegram_updates', row['id'], current, now + 7 * DAY)
        self.app.atomic(ack, now)
        return True

    def card(self, lead):
        labels = {'new': 'Новая', 'in_progress': 'В работе', 'done': 'Завершена'}
        created = datetime.fromtimestamp(lead['_createdEpoch'], CLUB_TZ).strftime('%d.%m.%Y %H:%M')
        lines = [f"АВТОСИМ · Заявка #{lead['leadNumber']}", '', 'Источник: ' + lead['source'],
                 'Имя: ' + lead['name'], 'Телефон: ' + lead['phone'],
                 'Пожелания: ' + (lead['message'] or 'Не указаны'), '',
                 'Статус: ' + labels[lead['status']], 'Создана: ' + created + ' (UTC+5)']
        if lead.get('assignedName'): lines.append('Ответственный: ' + lead['assignedName'])
        if lead.get('commentUntil'): lines.append('Ответь на эту карточку комментарием в течение часа.')
        if lead.get('completionComment'): lines.append('Комментарий завершения: ' + lead['completionComment'])
        if lead.get('completedName'): lines.append('Завершил: ' + lead['completedName'])
        def button(title, action):
            return {'text': title, 'callback_data': f"asl:{action}:{lead['id']}:{lead['version']}"}
        rows = []
        if lead['status'] == 'new': rows = [[button('Взять в работу', 'take')]]
        elif lead['status'] == 'in_progress':
            rows = [[button('Завершить без комментария' if lead.get('commentUntil') else 'Завершить', 'done')]]
            if not lead.get('commentUntil'): rows.append([button('Завершить с комментарием', 'comment')])
            rows.append([button('Вернуть в новые', 'release')])
        return {'text': '\n'.join(lines), 'reply_markup': {'inline_keyboard': rows}}

    def action(self, key, action, actor, version, now, comment=''):
        actor_id = str(actor['id'])
        actor_name = ('@' + actor['username']) if actor.get('username') else str(actor.get('first_name') or actor_id)
        def change(tx):
            lead = tx.get('leads', key)
            if not lead: fail(404, 'not_found', 'Заявка не найдена.')
            if lead['version'] != version: fail(409, 'stale', 'Карточка изменилась. Используй обновлённую.')
            if action == 'take':
                if lead['status'] != 'new': fail(409, 'taken', 'Заявка уже в работе.')
                lead.update(status='in_progress', assignedTo=actor_id, assignedName=actor_name, assignedAt=now, reminders=[])
            else:
                if lead['status'] != 'in_progress' or lead.get('assignedTo') != actor_id:
                    fail(403, 'not_assigned', 'Управлять заявкой может сотрудник, который взял её в работу.')
                if action == 'release':
                    lead.update(status='new', reminders=[], newSince=now)
                    for field in ('assignedTo', 'assignedName', 'assignedAt', 'commentUntil'): lead.pop(field, None)
                elif action == 'comment': lead['commentUntil'] = now + 3600
                elif action == 'done':
                    lead.update(status='done', completedName=actor_name, completedAt=stamp(now), completionComment=comment)
                    lead.pop('commentUntil', None)
                else: fail(400, 'invalid_action', 'Неизвестное действие.')
            lead['version'] += 1
            self.save(tx, lead, now)
            self.queue(tx, lead, now)
            self.app.audit(tx, now, 'lead.' + action, 'leads', key, actor=actor_id)
            return lead
        return self.app.atomic(change, now)

    def update(self, value, telegram, now):
        """Only the configured chat can view/change leads. No public lead read API."""
        callback = value.get('callback_query') or {}
        message = callback.get('message') or value.get('message') or {}
        actor = callback.get('from') or message.get('from') or {}
        chat_id = str(message.get('chat', {}).get('id', ''))
        allowed = os.environ.get('TELEGRAM_ADMIN_CHAT_ID', '')
        if not allowed or chat_id != allowed or actor.get('is_bot') or not actor.get('id'): return False
        # A private-chat sender must also be its owner; group members retain the old workflow.
        if not allowed.startswith('-') and str(actor['id']) != allowed: return False
        if callback:
            match = re.fullmatch(r'asl:(take|release|done|comment):([a-f0-9-]{36}):(\d+)', callback.get('data', ''))
            if not match: return False
            action, key, version = match.groups()
            try:
                self.action(key, action, actor, int(version), now)
                answer = 'Готово. Карточка обновится.'
            except Exception as error:
                from app import ApiError
                if not isinstance(error, ApiError): raise
                answer = error.message
            telegram('answerCallbackQuery', {'callback_query_id': callback['id'], 'text': answer})
            return True
        text = message.get('text', '').strip()
        command = text.split()[0].split('@')[0].lower() if text else ''
        statuses = {'/new': 'new', '/active': 'in_progress', '/done': 'done'}
        if command == '/retry_failed':
            def retry(tx):
                for job in self.app.scan(tx, 'lead_notifications'):
                    if job.get('state') != 'sent' and job.get('leaseUntil', 0) <= now:
                        job['nextAt'] = now
                        tx.put('lead_notifications', job['id'], job, now + CRM_DAYS * DAY)
            self.app.atomic(retry, now)
            telegram('sendMessage', {'chat_id': allowed, 'text': 'Ожидающие заявки поставлены на повторную отправку.'})
            return True
        if command in statuses:
            rows = self.app.atomic(lambda tx: [v for v in self.app.scan(tx, 'leads') if v['status'] == statuses[command]], now)
            for lead in sorted(rows, key=lambda v: v['_createdEpoch'], reverse=True)[:20]:
                # List copies have no action buttons; the original is the canonical card.
                telegram('sendMessage', {'chat_id': allowed, 'text': self.card(lead)['text']})
            if not rows: telegram('sendMessage', {'chat_id': allowed, 'text': 'Заявок с этим статусом нет.'})
            return True
        if command in ('/start', '/help', '/ping', '/chat_id'):
            text = 'ID чата: ' + allowed if command == '/chat_id' else 'АВТОСИМ · бот работает. /new — новые, /active — в работе, /done — завершённые. Ответь на карточку после «Завершить с комментарием».'
            telegram('sendMessage', {'chat_id': allowed, 'text': text})
            return True
        reply = message.get('reply_to_message', {}).get('message_id')
        if reply and text and not text.startswith('/'):
            rows = self.app.atomic(lambda tx: self.app.scan(tx, 'leads'), now)
            lead = next((v for v in rows if v.get('messageId') == reply and v.get('commentUntil', 0) > now), None)
            if lead:
                comment = text_field(text, 'Комментарий', 1000, required=True)
                self.action(lead['id'], 'done', actor, lead['version'], now, comment)
                return True
        return False

    def deliver(self, telegram, now):
        chat = os.environ.get('TELEGRAM_ADMIN_CHAT_ID', '')
        if not chat: return
        lease = secrets.token_urlsafe(24)
        def reserve(tx):
            for job in self.app.scan(tx, 'lead_notifications'):
                if job.get('state') == 'sent' or job.get('nextAt', 0) > now or job.get('leaseUntil', 0) > now: continue
                lead = tx.get('leads', job['id'])
                if not lead: continue
                job.update(lease=lease, leaseUntil=now + 90)
                tx.put('lead_notifications', job['id'], job, now + CRM_DAYS * DAY)
                return lead, job
        reserved = self.app.atomic(reserve, now)
        if not reserved: return
        lead, job = reserved
        payload = dict(self.card(lead), chat_id=chat)
        method = 'editMessageText' if lead.get('messageId') else 'sendMessage'
        if lead.get('messageId'): payload['message_id'] = lead['messageId']
        try:
            from telegram_client import TelegramMessageMissing
            try: result = telegram(method, payload)
            except TelegramMessageMissing:
                payload.pop('message_id', None)
                result = telegram('sendMessage', payload)
        except Exception:
            def retry(tx):
                current = tx.get('lead_notifications', lead['id'])
                if current and current.get('lease') == lease:
                    current.update(leaseUntil=0, nextAt=now + 30, state='pending')
                    tx.put('lead_notifications', lead['id'], current, now + CRM_DAYS * DAY)
            self.app.atomic(retry, now)
            raise
        def acknowledge(tx):
            current = tx.get('leads', lead['id'])
            current['messageId'] = result['message_id']
            current['telegramChatId'] = chat
            self.save(tx, current, now)
            queued = tx.get('lead_notifications', lead['id'])
            if queued and queued.get('lease') == lease:
                queued.update(leaseUntil=0, state='sent' if queued['version'] == lead['version'] else 'pending')
                tx.put('lead_notifications', lead['id'], queued, now + CRM_DAYS * DAY)
        self.app.atomic(acknowledge, now)

    def maintenance(self, telegram, now):
        chat = os.environ.get('TELEGRAM_ADMIN_CHAT_ID', '')
        if not chat: return
        rows = self.app.atomic(lambda tx: self.app.scan(tx, 'leads'), now)
        for lead in rows:
            if lead.get('commentUntil') and lead['commentUntil'] <= now:
                self.action(lead['id'], 'done', {'id': lead['assignedTo'], 'first_name': lead['assignedName']}, lead['version'], now)
                continue
            if lead['status'] not in ('new', 'in_progress') or not lead.get('messageId'): continue
            thresholds = [300, 600, 900] if lead['status'] == 'new' else [3600, 10800, 18000]
            age = now - (lead.get('newSince', lead['_createdEpoch']) if lead['status'] == 'new' else lead['assignedAt'])
            due = [n for n in thresholds if age >= n and n not in lead['reminders']]
            if not due: continue
            threshold = max(due)
            # Claim transactionally; expire a failed claim so a later tick retries.
            def claim(tx):
                current = tx.get('leads', lead['id'])
                if current['version'] != lead['version'] or threshold in current['reminders'] or current.get('reminderLease', 0) > now: return False
                current['reminderLease'] = now + 90
                self.save(tx, current, now)
                return True
            if not self.app.atomic(claim, now): continue
            telegram('sendMessage', {'chat_id': chat, 'text': f"Напоминание: заявка #{lead['leadNumber']} {'новая' if lead['status'] == 'new' else 'в работе'} более {threshold // 60} мин.",
                                     'reply_parameters': {'message_id': lead['messageId'], 'allow_sending_without_reply': True}})
            def mark(tx):
                current = tx.get('leads', lead['id'])
                if current['version'] == lead['version']:
                    current['reminders'] = sorted(set(current['reminders'] + [n for n in thresholds if n <= threshold]))
                    current['reminderLease'] = 0
                    self.save(tx, current, now)
            self.app.atomic(mark, now)
