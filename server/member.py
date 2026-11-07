"""Club accounts and requests; external synchronization is an explicit separate state."""
import hashlib
import hmac
import re
import secrets
import uuid
import unicodedata
from datetime import datetime,timezone
from http.cookies import SimpleCookie

from app import (DAY, CRM_DAYS, fields, text_field, flag, fail, stamp, parse_instant,
                 make_password_hash, password_parts, public_record)

COOKIE = '__Host-autosim_member'
SESSION_AGE = 7 * DAY
ACCOUNT_AGE = 365 * DAY
CONSENT_VERSION = '2026-09-25-member-v3'
USERNAME = re.compile(r'^[a-z0-9_]{4,32}$')
UUID = re.compile(r'^[a-f0-9-]{36}$')


def phone(value):
    value = text_field(value, 'телефон', 40)
    digits = re.sub(r'[^0-9]', '', value)
    if len(digits) == 11 and digits.startswith('8'):
        digits = '7' + digits[1:]
    if not re.fullmatch(r'7\d{10}', digits) and not (value.strip().startswith('+') and re.fullmatch(r'[1-9]\d{9,14}',digits)):
        fail(400, 'invalid_phone', 'Укажи телефон с кодом страны, например +7 и ещё 10 цифр.')
    return '+' + digits


def password(value):
    if (not isinstance(value, str) or not 8 <= len(value) <= 128 or
            not any(unicodedata.category(char)[0] in {'P', 'S'} for char in value)):
        fail(400, 'invalid_password', 'От 8 до 128 символов и хотя бы один спецсимвол: например, @, ! или #.')
    return value

def birth_date(value, now):
    try:
        born=datetime.strptime(value,'%Y-%m-%d').date()
        today=datetime.fromtimestamp(now,timezone.utc).date()
        age=today.year-born.year-((today.month,today.day)<(born.month,born.day))
        if not 15<=age<=110:raise ValueError()
        return born.isoformat()
    except (ValueError,TypeError):fail(400,'invalid_birth_date','Укажи дату рождения. SmartShell регистрирует клиентов с 15 лет.')


def verify_password(value, encoded):
    if not isinstance(value, str) or len(value) > 128:
        return False
    iterations, salt, expected = password_parts(encoded)
    return hmac.compare_digest(hashlib.pbkdf2_hmac('sha256', value.encode(), salt, iterations), expected)


def safe_user(user):
    return dict({k: user[k] for k in ('id', 'username', 'name', 'phone', 'pilotNumber', 'createdAt', 'version')}, birthDate=user.get('birthDate',''),integrationTest=bool(user.get('_ssTestClub')))


def safe_booking(value):
    keys = ('id', 'reference', 'startsAt', 'endsAt', 'duration', 'tariff', 'participants', 'vrCount',
            'priceRub', 'status', 'createdAt', 'updatedAt', 'version', 'ownerMessage', 'proposal', 'seatIds', 'seatLabels', 'allocationState', 'items')
    return {k: value.get(k) for k in keys}


class Members:
    def __init__(self, app):
        self.app = app

    def key(self, name):
        return self.app.digest('member:' + name)

    @staticmethod
    def cookie(token, age=SESSION_AGE):
        return f'{COOKIE}={token}; Path=/; Max-Age={age}; HttpOnly; Secure; SameSite=Strict'

    @staticmethod
    def token(request):
        try:
            cookies = SimpleCookie(request.headers.get('cookie', ''))
            token = cookies[COOKIE].value if COOKIE in cookies else ''
            return token if re.fullmatch(r'[A-Za-z0-9_-]{43}', token) else ''
        except Exception:
            return ''

    def limited(self, request, now, action, maximum=8, window=900, identity=''):
        def reserve(tx):
            global_key = 'member:' + action + ':global'
            if not self.app.rate_available(tx, global_key, now, maximum * 20):
                return False
            if not self.app.rate(tx, self.key(action + ':ip:' + (request.ip or 'unknown')), now, maximum, window):
                return False
            if identity and not self.app.rate(tx, self.key(action + ':user:' + identity), now, maximum, window):
                return False
            return self.app.rate(tx, global_key, now, maximum * 20, window)
        if not self.app.atomic(reserve, now):
            fail(429, 'rate_limited', 'Слишком много попыток. Подожди и попробуй позже.')

    def session(self, request, now, required=True):
        token = self.token(request)
        def read(tx):
            session = tx.get('member_sessions', self.key('session:' + token)) if token else None
            user = tx.get('members', session['userId']) if session else None
            if not user or user.get('disabled') or session['authVersion'] != user['authVersion']:
                return None
            return session, user
        value = self.app.atomic(read, now)
        if not value and required:
            fail(401, 'member_unauthorized', 'Войди в свой кабинет.')
        return value

    def create_session(self, tx, user, token, csrf, now):
        tx.put('member_sessions', self.key('session:' + token), {
            'userId': user['id'], 'authVersion': user['authVersion'], 'csrf': csrf,
            '_createdEpoch': now}, now + SESSION_AGE)

    def auth(self, request, now, action):
        self.app.check_origin(request, required=True)
        data = request.body()
        allowed = {'username', 'password'}
        if action == 'register':
            allowed |= {'name', 'consent', 'gameEntry', 'phone','birthDate'}
        if action == 'recover':
            allowed |= {'recoveryCode'}
        fields(data, allowed)
        username = text_field(data.get('username', ''), 'логин', 32).lower()
        self.limited(request, now, action, 5 if action == 'register' else 8,
                     DAY if action == 'register' else 900, username)
        if not USERNAME.fullmatch(username) or username in {'admin', 'admin333', 'autosim', 'avtosim', 'support'}:
            fail(400, 'invalid_username', 'Логин: 4–32 латинские буквы, цифры или _. Выбери личный позывной.')
        lookup = self.key('username:' + username)
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        if action == 'register':
            if data.get('consent') is not True:
                fail(400, 'consent_required', 'Подтверди обработку данных для кабинета и записи.')
            name = text_field(data.get('name', ''), 'имя', 40, True)
            encoded = make_password_hash(password(data.get('password')))
            recovery = secrets.token_urlsafe(32)
            user_id, guest_id = str(uuid.uuid4()), str(uuid.uuid4())
            sync_active=self.app.smartshell.sync.enabled(self.app.smartshell.config(now))
            contact=phone(data.get('phone','')) if sync_active or data.get('phone') else ''
            born=birth_date(data.get('birthDate',''),now) if sync_active or data.get('birthDate') else ''
            def register(tx):
                if tx.get('member_names', lookup):
                    fail(409, 'username_unavailable', 'Этот позывной недоступен. Выбери другой или войди.')
                user = {'id': user_id, 'username': username, 'name': name, 'phone': contact,'birthDate':born,
                        'pilotNumber': 'AS-' + secrets.token_hex(5).upper(), 'guestId': guest_id,
                        'createdAt': stamp(now), 'updatedAt': stamp(now), 'version': 1, 'authVersion': 1,
                        'passwordHash': encoded, 'recoveryHash': self.key('recovery:' + recovery),
                        'consentVersion': CONSENT_VERSION, 'consentedAt': stamp(now), '_createdEpoch': now}
                self.app.game.attribute_registration(tx, data.get('gameEntry'), user, now)
                tx.put('members', user_id, user, now + ACCOUNT_AGE)
                tx.put('member_names', lookup, {'id': user_id, '_createdEpoch': now}, now + ACCOUNT_AGE)
                guest = self.app.validate_guest({'name': name,'phone':contact}, now)
                guest.update(id=guest_id, version=1, createdAt=stamp(now), updatedAt=stamp(now),
                             source='website', _memberId=user_id, _createdEpoch=now)
                self.app.smartshell.sync.registration(tx,data,user,guest,now)
                tx.put('members',user_id,user,now+ACCOUNT_AGE)
                tx.put('guests', guest_id, guest, now + CRM_DAYS * DAY)
                self.create_session(tx, user, token, csrf, now)
                self.app.smartshell.queue_profile(tx, user, now)
                self.app.audit(tx, now, 'member.register', 'members', user_id, actor='member:' + user_id)
                return {'authenticated': True, 'user': safe_user(user), 'csrf': csrf, 'recoveryCode': recovery}
            payload=self.app.atomic(register,now)
            self.app.smartshell.sync.kick('profile:'+guest_id,now)
            return 201, payload, {'Set-Cookie': self.cookie(token)}
        def find(tx):
            name = tx.get('member_names', lookup)
            return tx.get('members', name['id']) if name else None
        user = self.app.atomic(find, now)
        if action == 'recover':
            password_new = make_password_hash(password(data.get('password')))
            code = text_field(data.get('recoveryCode', ''), 'код восстановления', 80)
            valid = hmac.compare_digest(self.key('recovery:' + code), user['recoveryHash'] if user else self.key('not-found'))
        else:
            valid = verify_password(data.get('password'), user['passwordHash'] if user else self.app.config.password_hash)
        if not user or user.get('disabled') or not valid:
            fail(401, 'invalid_credentials', 'Не удалось войти. Проверь позывной и данные входа.')
        recovery = secrets.token_urlsafe(32) if action == 'recover' else None
        def finish(tx):
            current = tx.get('members', user['id'])
            if not current or current.get('disabled') or current['authVersion'] != user['authVersion']:
                fail(401, 'invalid_credentials', 'Данные входа изменились. Повтори вход.')
            if action == 'recover':
                if not hmac.compare_digest(current['recoveryHash'], user['recoveryHash']):
                    fail(401, 'invalid_credentials', 'Код уже использован.')
                current.update(passwordHash=password_new, recoveryHash=self.key('recovery:' + recovery),
                               authVersion=current['authVersion'] + 1, version=current['version'] + 1)
            current['updatedAt'] = stamp(now)
            tx.put('members', current['id'], current, now + ACCOUNT_AGE)
            tx.put('member_names', lookup, {'id': current['id'], '_createdEpoch': now}, now + ACCOUNT_AGE)
            self.app.audit(tx, now, 'member.' + action, 'members', current['id'], actor='member:' + current['id'])
            if action == 'recover':
                return {'ok': True, 'recoveryCode': recovery}
            self.create_session(tx, current, token, csrf, now)
            return {'authenticated': True, 'user': safe_user(current), 'csrf': csrf}
        payload = self.app.atomic(finish, now)
        return 200, payload, {'Set-Cookie': self.cookie(token if action == 'login' else '', SESSION_AGE if action == 'login' else 0)}

    def dashboard(self, user, now):
        def read(tx):
            # Queue legacy profiles locally; the durable minute worker performs
            # external requests. Opening a cabinet must not wait on SmartShell.
            self.app.smartshell.sync.queue_profile(tx, user, now)
            rows = tx.scan('member_bookings:' + user['id'], limit=501)
            values = [tx.get('bookings', row['id']) for row in rows]
            values = [row for row in values if row and row.get('_memberId') == user['id']]
            values.sort(key=lambda row: row['startsAt'], reverse=True)
            guest = tx.get('guests', user['guestId'])
            skill = None
            if guest and guest.get('_memberId') == user['id'] and guest.get('skillVerified'):
                skill = {'note': guest['skillNote'], 'verifiedAt': guest['skillVerifiedAt']}
            return {'user': safe_user(user), 'bookings': [safe_booking(row) for row in values[:100]],
                    'completedVisits': sum(row['status'] == 'completed' for row in values),
                    'historyTruncated': len(rows) > 500 or len(values) > 100, 'skill': skill,
                    'serverTime': stamp(now), 'notificationChannel': 'owner_telegram',
                    'smartshell':self.app.smartshell.sync.summary(tx,user['guestId'])}
        return self.app.atomic(read, now)

    def queue(self, tx, booking, now):
        self.app.smartshell.queue_booking(tx, booking, now)
        guest=tx.get('guests',booking.get('guestId') or '')
        if guest and guest.get('_ssFixture'):return  # Explicit QA fixtures only.
        for owner_id in self.app.booking_bot.owners(tx):
            self.queue_notification(tx, booking, owner_id, now)

    def queue_notification(self, tx, booking, owner_id, now):
        key = self.app.booking_bot.delivery_key(booking['id'], owner_id)
        previous = tx.get('booking_notifications', key) or {}
        cancellation_version = 0
        if booking['status'] == 'cancelled':
            cancellation_version = (previous.get('cancellationVersion') if previous.get('status') == 'cancelled' else 0) or booking['version']
        tx.put('booking_notifications', key, {'id': booking['id'], 'ownerId': owner_id, 'version': booking['version'],
               'status': booking['status'], 'cancellationVersion': cancellation_version,
               'state': 'pending', 'attempts': 0, 'leaseUntil': 0, 'nextAt': now,
               'forceNew': previous.get('forceNew', False),
               'lastRequestedAt': previous.get('lastRequestedAt'),
               '_lastRequestedEpoch': previous.get('_lastRequestedEpoch', 0),
               'createdAt': stamp(now), '_createdEpoch': now}, now + 30 * DAY)

    def create_booking(self, request, user, now):
        if len(self.app.config.booking_secret) < 32 or not self.app.config.booking_owner_id:
            fail(503, 'booking_unavailable', 'Онлайн-запись ещё не включена. Позвони в клуб.')
        data = request.body()
        fields(data, {'requestId', 'phone', 'startsAt', 'duration', 'tariff', 'participants', 'vrCount', 'comment', 'consent', 'seatIds'})
        request_id = data.get('requestId', '')
        if not isinstance(request_id, str) or not UUID.fullmatch(request_id):
            fail(400, 'request_id_required', 'Обнови страницу и повтори отправку.')
        if data.get('consent') is not True:
            fail(400, 'consent_required', 'Разреши передать владельцам клуба контакт и параметры записи.')
        contact = phone(data.get('phone', ''))
        comment = text_field(data.get('comment', ''), 'пожелания', 500)
        body = {key: data[key] for key in ('startsAt', 'duration', 'tariff', 'participants', 'vrCount', 'seatIds') if key in data}
        body.update(guestName=user['name'], phone=contact, guestId=user['guestId'], notes=comment, status='draft')
        value = self.app.validate_booking(body, now)
        # Idempotent retries must return their original allocation, even if that
        # allocation is now occupied by this very request.
        previous = self.app.atomic(lambda tx: tx.get('booking_requests', self.key('request:' + user['id'] + ':' + request_id)), now)
        if previous:
            found = self.app.atomic(lambda tx: tx.get('bookings', previous['id']), now)
            if found: return safe_booking(found)
        integrated = self.app.smartshell.sync.enabled(self.app.smartshell.config(now))
        start = parse_instant(value['startsAt']).timestamp()
        if not now + 15 * 60 <= start <= now + 90 * DAY or parse_instant(value['startsAt']).minute % 15:
            fail(400, 'invalid_booking_time', 'Выбери начало с шагом 15 минут: не раньше чем через 15 минут и в пределах 90 дней.')
        allocation = self.app.seats.prepare(value, data.get('seatIds'), now) if integrated else None
        record_id = str(uuid.uuid4())
        def create(tx):
            current = tx.get('members', user['id'])
            if not current or current.get('disabled') or current['authVersion'] != user['authVersion']:
                fail(401, 'member_unauthorized', 'Войди ещё раз.')
            key = self.key('request:' + user['id'] + ':' + request_id)
            previous = tx.get('booking_requests', key)
            if previous:
                booking = tx.get('bookings', previous['id'])
                if booking:
                    return safe_booking(booking)
                fail(409, 'request_expired', 'Эта заявка уже обработана. Обнови страницу.')
            rows = tx.scan('member_bookings:' + user['id'], limit=501)
            active = [tx.get('bookings', row['id']) for row in rows]
            if sum(bool(row and row['status'] in {'draft', 'confirmed'} and parse_instant(row['endsAt']).timestamp() > now) for row in active) >= 3:
                fail(409, 'too_many_bookings', 'У тебя уже три активные записи. Дождись ответа или отмени лишнюю.')
            if not self.app.rate_available(tx, 'booking:create:global', now, 100):
                fail(429, 'booking_limit', 'Онлайн-запись временно ограничена. Позвони в клуб.')
            if not self.app.rate(tx, self.key('booking:create:' + user['id']), now, 8, DAY):
                fail(429, 'booking_limit', 'Сегодня было много заявок. Позвони в клуб.')
            self.app.rate(tx, 'booking:create:global', now, 100, DAY)
            guest = tx.get('guests', user['guestId'])
            if not guest:
                guest = self.app.validate_guest({'name': current['name']}, now)
                guest.update(id=user['guestId'], version=0, createdAt=stamp(now), _memberId=user['id'], _createdEpoch=now)
            if guest.get('_memberId') != user['id']:
                fail(409, 'profile_mismatch', 'Карточка требует проверки. Позвони в клуб.')
            guest.update(phone=contact, version=guest['version'] + 1, updatedAt=stamp(now), source='website')
            tx.put('guests', guest['id'], guest, now + CRM_DAYS * DAY)
            current.update(phone=contact, version=current['version'] + 1, updatedAt=stamp(now))
            tx.put('members', current['id'], current, now + ACCOUNT_AGE)
            booking = dict(value, id=record_id, reference='AS-' + secrets.token_hex(4).upper(), source='website',
                           ownerMessage='', version=1, createdAt=stamp(now), updatedAt=stamp(now),
                           _memberId=user['id'], _createdEpoch=now)
            if allocation:
                self.app.seats.assert_free(tx, booking, *allocation, now)
                self.app.seats.invalidate(tx)
            tx.put('bookings', record_id, booking, now + CRM_DAYS * DAY)
            tx.put('member_bookings:' + user['id'], record_id, {'id': record_id, '_createdEpoch': now}, now + CRM_DAYS * DAY)
            tx.put('booking_requests', key, {'id': record_id, '_createdEpoch': now}, now + CRM_DAYS * DAY)
            self.queue(tx, booking, now)
            self.app.audit(tx, now, 'booking.request', 'bookings', record_id, actor='member:' + user['id'])
            return safe_booking(booking)
        result = self.app.atomic(create, now)
        if allocation:
            self.app.smartshell.sync.kick('booking:'+result['id'], now)
            result = self.app.atomic(lambda tx: safe_booking(tx.get('bookings', result['id'])), now)
        return result

    def cancel_booking(self, request, user, record_id, now):
        data = request.body()
        fields(data, {'version'})
        def cancel(tx):
            booking = tx.get('bookings', record_id)
            if not booking or booking.get('_memberId') != user['id']:
                fail(404, 'not_found', 'Запись не найдена.')
            self.app.check_version(data, booking)
            if booking['status'] not in {'draft', 'confirmed'} or parse_instant(booking['startsAt']).timestamp() <= now:
                fail(409, 'booking_closed', 'Изменение этой записи доступно через клуб по телефону.')
            booking.update(status='cancelled', proposal=None, ownerMessage='Отменено гостем', version=booking['version'] + 1, updatedAt=stamp(now))
            tx.put('bookings', record_id, booking, now + CRM_DAYS * DAY)
            self.queue(tx, booking, now)
            self.app.audit(tx, now, 'booking.member_cancel', 'bookings', record_id, actor='member:' + user['id'])
            return safe_booking(booking)
        return self.app.atomic(cancel, now)

    def profile(self, request, user, now):
        data = request.body()
        fields(data, {'name', 'phone', 'birthDate', 'version'})
        name = text_field(data.get('name', user['name']), 'имя', 40, True)
        contact = phone(data['phone']) if data.get('phone') else ''
        born=birth_date(data['birthDate'],now) if data.get('birthDate') else user.get('birthDate','')
        def change(tx):
            current = tx.get('members', user['id'])
            if not current or current['authVersion'] != user['authVersion']:
                fail(401, 'member_unauthorized', 'Войди ещё раз.')
            self.app.check_version(data, current)
            current.update(name=name, phone=contact,birthDate=born, version=current['version'] + 1, updatedAt=stamp(now))
            tx.put('members', current['id'], current, now + ACCOUNT_AGE)
            guest = tx.get('guests', current['guestId'])
            if guest and guest.get('_memberId') == user['id']:
                guest.update(name=name, phone=contact, version=guest['version'] + 1, updatedAt=stamp(now))
                tx.put('guests', guest['id'], guest, now + CRM_DAYS * DAY)
            self.app.smartshell.sync.queue_profile(tx,current,now)
            return safe_user(current)
        result=self.app.atomic(change, now)
        self.app.smartshell.sync.kick('profile:'+user['guestId'],now)
        return result

    def accept_proposal(self, request, user, record_id, now):
        data = request.body()
        fields(data, {'version'})
        candidate = self.app.atomic(lambda tx: tx.get('bookings',record_id), now)
        if not candidate or candidate.get('_memberId') != user['id']: fail(404,'not_found','Запись не найдена.')
        self.app.check_version(data,candidate)
        if not candidate.get('proposal'): fail(409,'proposal_unavailable','Предложение уже изменилось.')
        candidate=self.app.validate_booking({'startsAt':candidate['proposal']['startsAt']},now,candidate)
        allocation=self.app.seats.preflight(candidate,now,record_id)
        def accept(tx):
            booking = tx.get('bookings', record_id)
            if not booking or booking.get('_memberId') != user['id']:
                fail(404, 'not_found', 'Запись не найдена.')
            self.app.check_version(data, booking)
            if booking['status'] not in {'draft','confirmed'} or not booking.get('proposal'):
                fail(409, 'proposal_unavailable', 'Предложение уже изменилось. Обнови кабинет.')
            if parse_instant(booking['proposal']['startsAt']).timestamp() <= now + 900:
                fail(409, 'proposal_expired', 'Предложенное время уже близко. Позвони в клуб.')
            booking = self.app.validate_booking({'startsAt': booking['proposal']['startsAt']}, now, booking)
            if allocation:
                booking.update({k:candidate[k] for k in ('seatIds','seatLabels','_hostIds','allocationState')})
                self.app.seats.assert_free(tx, booking, *allocation, now, record_id)
            booking.update(proposal=None, ownerMessage='Новое время согласовано с гостем.' if booking['status']=='confirmed' else 'Новое время согласовано. Ждём подтверждения клуба.',
                           version=booking['version'] + 1, updatedAt=stamp(now))
            tx.put('bookings', booking['id'], booking, now + CRM_DAYS * DAY)
            self.queue(tx, booking, now)
            self.app.audit(tx, now, 'booking.accept_proposal', 'bookings', booking['id'], actor='member:' + user['id'])
            return safe_booking(booking)
        return self.app.atomic(accept, now)

    def change_password(self, request, user, now):
        data = request.body()
        fields(data, {'currentPassword', 'password'})
        self.limited(request, now, 'password', identity=user['id'])
        if not verify_password(data.get('currentPassword'), user['passwordHash']):
            fail(401, 'wrong_password', 'Текущий пароль не подошёл.')
        encoded = make_password_hash(password(data.get('password')))
        recovery, token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        def change(tx):
            current = tx.get('members', user['id'])
            if not current or current['authVersion'] != user['authVersion']:
                fail(401, 'member_unauthorized', 'Войди ещё раз.')
            current.update(passwordHash=encoded, recoveryHash=self.key('recovery:' + recovery),
                           authVersion=current['authVersion'] + 1, version=current['version'] + 1, updatedAt=stamp(now))
            tx.put('members', current['id'], current, now + ACCOUNT_AGE)
            self.create_session(tx, current, token, csrf, now)
            self.app.audit(tx, now, 'member.password', 'members', current['id'], actor='member:' + current['id'])
            return {'authenticated': True, 'user': safe_user(current), 'csrf': csrf, 'recoveryCode': recovery}
        return self.app.atomic(change, now), {'Set-Cookie': self.cookie(token)}

    def handle(self, request, now):
        route = request.path[len('/api/member/'):]
        if route in {'register', 'login', 'recover'} and request.method == 'POST':
            status, payload, headers = self.auth(request, now, route)
            return self.app.response(request, status, payload, headers)
        if route == 'session' and request.method == 'GET':
            result = self.session(request, now, False)
            return self.app.response(request, 200, {'authenticated': bool(result),
                'csrf': result[0]['csrf'] if result else None, 'user': safe_user(result[1]) if result else None,
                'clubProfileRequired':self.app.smartshell.sync.enabled(self.app.smartshell.config(now))})
        session, user = self.session(request, now)
        if request.method != 'GET':
            self.app.csrf(request, session)
        if route == 'logout' and request.method == 'POST':
            self.app.atomic(lambda tx: tx.delete('member_sessions', self.key('session:' + self.token(request))), now)
            return self.app.response(request, 200, {'ok': True}, {'Set-Cookie': self.cookie('', 0)})
        if route == 'me' and request.method == 'GET':
            return self.app.response(request, 200, self.dashboard(user, now))
        if route == 'me' and request.method == 'PATCH':
            return self.app.response(request, 200, {'user': self.profile(request, user, now)})
        if route == 'smartshell/verification' and request.method == 'POST':
            return self.app.response(request,200,self.app.smartshell.sync.verify_member(request,user,now))
        if route == 'password' and request.method == 'POST':
            payload, headers = self.change_password(request, user, now)
            return self.app.response(request, 200, payload, headers)
        if route == 'bookings' and request.method == 'POST':
            return self.app.response(request, 201, self.create_booking(request, user, now))
        match = re.fullmatch(r'bookings/([a-f0-9-]{36})/cancel', route)
        if match and request.method == 'POST':
            payload=self.cancel_booking(request,user,match[1],now)
            self.app.smartshell.sync.kick('booking:'+match[1],now)
            return self.app.response(request,200,payload)
        match = re.fullmatch(r'bookings/([a-f0-9-]{36})/accept-proposal', route)
        if match and request.method == 'POST':
            payload=self.accept_proposal(request,user,match[1],now)
            self.app.smartshell.sync.kick('booking:'+match[1],now)
            return self.app.response(request,200,payload)
        fail(404, 'not_found', 'Раздел кабинета не найден.')
