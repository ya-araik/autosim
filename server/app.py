"""AUTOSIM private administration API. Standard library only outside the YDB adapter."""
import base64
import csv
import hashlib
import hmac
import io
import ipaddress
import json
import os
import re
import secrets
import time
import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from http.cookies import SimpleCookie
from urllib.parse import parse_qs, urlsplit

VERSION = "2026.10.25"
DAY = 86400
CLUB_TZ = timezone(timedelta(hours=5))
COOKIE = "__Host-autosim_admin"
SESSION_SECONDS = 8 * 3600
ANALYTICS_DAYS, AUDIT_DAYS, CRM_DAYS = 30, 90, 365
MAX_REPORT_ROWS = 10000
PRICES = {"standard": {30: 350, 60: 650, 120: 1150},
          "pro": {30: 500, 60: 800, 120: 1500},
          "vip": {30: 500, 60: 800, 120: 1500}}
VR_PRICES = {30: 300, 60: 400, 120: 800}
EVENTS = {"page_view", "click", "booking_intent", "visit_plan"}
TARGETS = {"call", "smartgamer", "plan", "share", "calendar", "map", "vk", "telegram",
           "tariff_standard", "tariff_pro", "tariff_vip", "cockpit", "coach", "booking",
           "directions", "guest_card", "print", "download"}
SECTIONS = {"hero", "experience", "equipment", "prices", "visit-planner", "company",
            "club", "gallery", "contacts", "faq", "my-garage", "cockpit", "engineering"}
ID_RE = re.compile(r"^[A-Za-z0-9_-]{16,80}$")


class ApiError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message


def fail(status, code, message):
    raise ApiError(status, code, message)


def stamp(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def public_record(value):
    return {key: item for key, item in value.items() if not key.startswith("_")}


def text_field(value, name, maximum=200, required=False):
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 and c not in "\n\t" for c in value):
        fail(400, "invalid_field", f"Некорректное поле: {name}.")
    value = value.strip()
    if required and not value:
        fail(400, "required_field", f"Заполните поле: {name}.")
    return value


def integer(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        fail(400, "invalid_field", f"Некорректное поле: {name}.")
    return value


def flag(value, name):
    if not isinstance(value, bool):
        fail(400, "invalid_field", f"Некорректное поле: {name}.")
    return value


def fields(body, allowed):
    if not isinstance(body, dict) or set(body) - set(allowed):
        fail(400, "unknown_field", "Запрос содержит неизвестные поля.")


def validate_contact(value, name):
    value = text_field(value, name, 120 if name == "email" else 40)
    if value and name == "email" and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
        fail(400, "invalid_email", "Проверьте email.")
    if value and name == "phone" and not re.fullmatch(r"\+?[0-9 ()-]{7,25}", value):
        fail(400, "invalid_phone", "Проверьте номер телефона.")
    return value


def parse_instant(value):
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if result.tzinfo is None:
            raise ValueError()
        return result
    except (ValueError, TypeError, AttributeError):
        fail(400, "invalid_datetime", "Укажите дату и время с часовым поясом.")


def make_password_hash(password, iterations=600000, salt=None):
    salt = salt or secrets.token_bytes(24)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    encode = lambda value: base64.urlsafe_b64encode(value).decode()
    return f"pbkdf2_sha256${iterations}${encode(salt)}${encode(digest)}"


def password_parts(encoded):
    algorithm, iterations, salt, digest = encoded.split("$")
    count = int(iterations)
    salt = base64.urlsafe_b64decode(salt + "=" * (-len(salt) % 4))
    digest = base64.urlsafe_b64decode(digest + "=" * (-len(digest) % 4))
    if algorithm != "pbkdf2_sha256" or not 200000 <= count <= 2000000 or len(salt) < 16 or len(digest) != 32:
        raise ValueError("Invalid password hash configuration")
    return count, salt, digest


@dataclass(frozen=True)
class Config:
    username: str
    password_hash: str
    secret: str
    origins: tuple
    ydb_endpoint: str = ""
    ydb_database: str = ""
    booking_secret: str = ""
    booking_owner_id: str = ""

    def __post_init__(self):
        password_parts(self.password_hash)
        if not self.username or len(self.secret) < 32 or not self.origins:
            raise ValueError("Missing authentication configuration")
        for origin in self.origins:
            parsed = urlsplit(origin)
            if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or "*" in origin:
                raise ValueError("Exact HTTPS origins are required")

    @classmethod
    def from_env(cls):
        return cls(os.environ["ADMIN_USERNAME"], os.environ["ADMIN_PASSWORD_HASH"],
                   os.environ["SESSION_SECRET"], tuple(origin.strip().rstrip("/") for origin in
                   os.environ["ALLOWED_ORIGINS"].split(",") if origin.strip()),
                   os.environ["YDB_ENDPOINT"], os.environ["YDB_DATABASE"],
                   os.environ.get('BOOKING_BRIDGE_SECRET', ''), os.environ.get('BOOKING_OWNER_ID', ''))


class Request:
    def __init__(self, event):
        self.event = event
        self.headers = {str(k).lower(): str(v) for k, v in (event.get("headers") or {}).items()}
        context = event.get("requestContext") or {}
        self.method = str(event.get("httpMethod") or (context.get("http") or {}).get("method") or "GET").upper()
        self.path = str(event.get("path") or event.get("rawPath") or "/").rstrip("/") or "/"
        self.query = event.get("queryStringParameters") or {}
        if not self.query and event.get("rawQueryString"):
            self.query = {key: values[-1] for key, values in parse_qs(event["rawQueryString"]).items()}
        # API Gateway's authenticated invocation context is authoritative. Never trust X-Forwarded-For.
        source_ip = (context.get("identity") or {}).get("sourceIp") or (context.get("http") or {}).get("sourceIp")
        try:
            self.ip = str(ipaddress.ip_address(source_ip))
        except (ValueError, TypeError):
            self.ip = None
        self.origin = self.headers.get("origin", "")
        self.id = str(uuid.uuid4())

    def body(self):
        if "application/json" not in self.headers.get("content-type", "").lower():
            fail(415, "json_required", "Ожидается JSON.")
        raw = self.event.get("body") or "{}"
        if not isinstance(raw, str) or len(raw) > 24000:
            fail(413, "body_too_large", "Слишком большой запрос.")
        if self.event.get("isBase64Encoded"):
            try:
                raw = base64.b64decode(raw, validate=True).decode("utf-8")
            except (ValueError, UnicodeError):
                fail(400, "invalid_json", "Некорректный JSON.")
        if not isinstance(raw, str) or len(raw.encode("utf-8")) > 16384:
            fail(413, "body_too_large", "Слишком большой запрос.")
        try:
            def unique_pairs(pairs):
                result = {}
                for key, item in pairs:
                    if key in result: raise ValueError('Duplicate JSON key')
                    result[key] = item
                return result
            value = json.loads(raw, object_pairs_hook=unique_pairs,
                               parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            if not isinstance(value, dict):
                raise ValueError()
            stack = [(value, 0)]
            while stack:
                item, depth = stack.pop()
                if depth > 32: raise ValueError('JSON nesting limit')
                if isinstance(item, dict): stack.extend((v, depth+1) for v in item.values())
                elif isinstance(item, list): stack.extend((v, depth+1) for v in item)
            return value
        except (ValueError, TypeError, RecursionError):
            fail(400, "invalid_json", "Некорректный JSON.")

    def token(self):
        try:
            cookies = SimpleCookie(self.headers.get("cookie", ""))
            token = cookies[COOKIE].value if COOKIE in cookies else ""
            return token if re.fullmatch(r"[A-Za-z0-9_-]{43,100}", token) else ""
        except Exception:
            return ""


class Application:
    def __init__(self, config, store, clock=time.time):
        self.config, self.store, self.clock = config, store, clock
        self.password = password_parts(config.password_hash)
        from admin_access import AdminAccess
        self.access = AdminAccess(self)
        from smartshell import SmartShell
        self.smartshell = SmartShell(self)
        from member import Members
        self.members = Members(self)
        from game import Game
        self.game = Game(self)
        from club_admin import ClubAdmin
        self.club_admin = ClubAdmin(self)
        from booking_bot import BookingBot
        self.booking_bot = BookingBot(self)
        from seat_booking import SeatBooking
        self.seats = SeatBooking(self)
        from source_release import SourceRelease
        self.source_release = SourceRelease(self)
        from leads import Leads
        self.leads = Leads(self)

    def digest(self, value):
        return hmac.new(self.config.secret.encode(), value.encode(), hashlib.sha256).hexdigest()

    def atomic(self, callback, now):
        return self.store.atomic(callback, int(now))

    def response(self, request, status, payload, extra=None, content_type="application/json; charset=utf-8"):
        headers = {"Content-Type": content_type, "Cache-Control": "no-store, private",
                   "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
                   "X-Request-Id": request.id, "Vary": "Origin"}
        if request.origin in self.config.origins:
            headers.update({"Access-Control-Allow-Origin": request.origin,
                            "Access-Control-Allow-Credentials": "true"})
        headers.update(extra or {})
        body = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False, allow_nan=False)
        return {"statusCode": status, "headers": headers, "body": body, "isBase64Encoded": False}

    def check_origin(self, request, required=False):
        if (required and not request.origin) or (request.origin and request.origin not in self.config.origins):
            fail(403, "origin_denied", "Недопустимый источник запроса.")
        if request.headers.get("sec-fetch-site") == "cross-site":
            fail(403, "origin_denied", "Недопустимый источник запроса.")

    def session(self, request, now, required=True):
        token = request.token()
        value = self.atomic(lambda tx: tx.get("sessions", self.digest("session:" + token)), now) if token else None
        value = self.access.resolve(value, now)
        if not value and required:
            fail(401, "unauthorized", "Войдите в админку.")
        return value

    def csrf(self, request, session):
        self.check_origin(request, required=True)
        supplied = request.headers.get("x-csrf-token", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", supplied) or not hmac.compare_digest(supplied, session["csrf"]):
            fail(403, "csrf_denied", "Обновите страницу и повторите действие.")

    def audit(self, tx, now, action, entity="", entity_id="", details=None, actor=None):
        from admin_access import ACTOR
        actor = actor or ACTOR.get()
        key = str(uuid.uuid4())
        tx.put("audit", key, {"id": key, "action": action, "entity": entity,
               "entityId": entity_id, "actor": actor or self.config.username,
               "createdAt": stamp(now), "details": details or {}, "_createdEpoch": now}, now + AUDIT_DAYS * DAY)

    def rate(self, tx, key, now, maximum, window):
        value = tx.get("limits", key)
        if not value or now >= value["resetAt"]:
            value = {"count": 0, "resetAt": now + window, "_createdEpoch": now}
        if value["count"] >= maximum:
            return False
        value["count"] += 1
        tx.put("limits", key, value, now + DAY)
        return True

    @staticmethod
    def rate_available(tx, key, now, maximum):
        value = tx.get("limits", key)
        return not value or now >= value["resetAt"] or value["count"] < maximum

    def settings(self, tx):
        return tx.get("settings", "main") or {"analyticsEnabled": True, "collectFullIp": True,
                "operationalNotes": "", "version": 1}

    def scan(self, tx, bucket, since=0, until=9999999999):
        rows = tx.scan(bucket, since, until)
        if len(rows) > MAX_REPORT_ROWS:
            fail(422, "range_too_large", "В выборке более 10 000 записей. Выберите меньший период.")
        return rows

    def handle(self, event, context=None):
        from admin_access import ACTOR
        token = ACTOR.set(None)
        try:
            return self._handle(event, context)
        finally:
            ACTOR.reset(token)

    def _handle(self, event, context=None):
        # Direct maintenance invocation requires IAM; the function must not be public.
        if event.get("task") == "purge" and not event.get("httpMethod") and not event.get("requestContext"):
            now = int(self.clock())
            return {"purged": self.atomic(lambda tx: tx.purge(), now)}
        request = Request(event)
        now = int(self.clock())
        try:
            if request.method not in {'GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'}:
                fail(405, 'method_not_allowed', 'Метод не поддерживается.')
            if request.method == "OPTIONS":
                self.check_origin(request, required=True)
                return self.response(request, 204, "", {
                    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type,X-CSRF-Token",
                    "Access-Control-Max-Age": "600"})
            self.check_origin(request)
            if request.path == '/api/telegram/webhook' and request.method == 'POST':
                return self.response(request, 200, self.leads.webhook(request, now))
            if request.path == '/api/leads' and request.method == 'POST':
                return self.response(request, 202, self.leads.create(request, now))
            if request.path.startswith('/api/source/'):
                return self.source_release.handle(request, now)
            if request.path == '/api/member/availability' and request.method == 'GET':
                return self.response(request, 200, self.seats.availability(request, now))
            if request.path.startswith('/api/booking-bot/'):
                return self.booking_bot.handle(request, now)
            if request.path.startswith('/api/member/'):
                return self.members.handle(request, now)
            if request.path.startswith('/api/game/'):
                return self.game.handle(request, now)
            if request.path == "/api/analytics" and request.method == "POST":
                self.check_origin(request, required=True)
                return self.response(request, 202, self.analytics(request, now))
            if not request.path.startswith("/api/admin/"):
                fail(404, "not_found", "Ресурс не найден.")
            if request.path == "/api/admin/login" and request.method == "POST":
                self.check_origin(request, required=True)
                payload, cookie = self.login(request, now)
                return self.response(request, 200, payload, {"Set-Cookie": cookie})
            if request.path == "/api/admin/session" and request.method == "GET":
                current = self.session(request, now, required=False)
                return self.response(request, 200, {"authenticated": bool(current),
                    "user": current["user"] if current else None,
                    "csrf": current["csrf"] if current else None})
            current = self.session(request, now)
            from admin_access import ACTOR
            ACTOR.set(current["user"]["username"])
            self.access.authorize(request, current)
            if request.method in {"POST", "PATCH", "DELETE"}:
                self.csrf(request, current)
            if request.path == '/api/admin/smartshell' or request.path.startswith('/api/admin/smartshell/'):
                return self.response(request, 200, self.smartshell.handle(request, current, now))
            if request.path == '/api/admin/access':
                return self.response(request, 200, self.access.handle(request, current, now))
            if request.path == '/api/admin/game-reward':
                return self.response(request, 200, self.game.rewards.admin(request, now))
            if request.path == '/api/admin/game-settings':
                return self.response(request, 200, self.club_admin.configure(request, now))
            if request.path == '/api/admin/game-reviews':
                return self.response(request, 200, self.club_admin.reviews(request, now))
            if request.path == '/api/admin/profiles':
                return self.response(request, 200, self.club_admin.profiles(request, now))
            if request.path.startswith('/api/admin/profiles/'):
                payload = self.club_admin.profile(request, now, request.path.rsplit('/',1)[-1])
                if not current['user']['isOwner'] and 'smartshell.clients' not in current['user']['permissions']:
                    payload.pop('smartshell', None)
                return self.response(request, 200, payload)
            if request.path == '/api/admin/game':
                return self.response(request, 200, self.game.admin(request, now))
            if request.path == "/api/admin/logout" and request.method == "POST":
                def logout(tx):
                    tx.delete("sessions", self.digest("session:" + request.token()))
                    self.audit(tx, now, "auth.logout")
                self.atomic(logout, now)
                return self.response(request, 200, {"ok": True}, {"Set-Cookie": self.cookie("", 0)})
            if request.path == "/api/admin/health" and request.method == "GET":
                def booking_health(tx):
                    pending = [j for j in self.scan(tx, 'booking_notifications') if j['state'] != 'sent']
                    pulse = tx.get('integration_health', 'booking_bot') or {}
                    return {'configured': bool(self.config.booking_secret and self.config.booking_owner_id),
                            'ownerCount': len(self.booking_bot.owners(tx)),
                            'pending': len(pending), 'retrying': sum(j['attempts'] > 1 for j in pending),
                            'lastPoll': pulse.get('lastPoll'), 'accounts': len(self.scan(tx, 'members'))}
                return self.response(request, 200, {"ok": True,
                    "database": {"status": "connected", "version": self.store.kind},
                    "serverTime": stamp(now), "version": VERSION, 'bookingChannel': self.atomic(booking_health, now)})
            if request.path == "/api/admin/settings":
                return self.response(request, 200, self.settings_endpoint(request, now))
            delivery_route = re.fullmatch(r'/api/admin/bookings/([a-f0-9-]{36})/notification', request.path)
            if delivery_route:
                return self.response(request, 200, self.booking_bot.delivery_endpoint(request, current, delivery_route[1], now))
            for resource in ("bookings", "guests"):
                prefix = "/api/admin/" + resource
                if request.path == prefix or request.path.startswith(prefix + "/"):
                    if resource=="bookings" and request.method in {"POST","PATCH","DELETE"}:
                        if self.smartshell.sync.enabled(self.smartshell.config(now)):
                            self.access.require(current,'smartshell.bookings.write')
                    status, payload = self.crm(request, now, resource, request.path[len(prefix):].strip("/"))
                    if resource=="bookings" and request.method in {"POST","PATCH"} and payload.get("id"):
                        payload["smartshell"]=self.smartshell.sync.kick("booking:"+payload["id"],now)
                    return self.response(request, status, payload)
            if request.method == "GET":
                if request.path == "/api/admin/overview":
                    return self.response(request, 200, self.overview(request, now))
                if request.path in {"/api/admin/events", "/api/admin/visitors", "/api/admin/audit"}:
                    return self.response(request, 200, self.reporting_list(request, now))
                if request.path == "/api/admin/export":
                    body, name = self.export(request, now)
                    return self.response(request, 200, body,
                        {"Content-Disposition": f'attachment; filename="autosim-{name}.csv"'},
                        "text/csv; charset=utf-8")
            fail(404, "not_found", "Ресурс не найден.")
        except ApiError as error:
            extra = {"Retry-After": "900"} if error.status == 429 else None
            return self.response(request, error.status,
                {"error": {"code": error.code, "message": error.message}, "message": error.message}, extra)
        except Exception:
            return self.response(request, 503, {"error": {"code": "service_unavailable",
                "message": "Сервис временно недоступен. Повторите позже."}})

    @staticmethod
    def cookie(token, age):
        return f"{COOKIE}={token}; Path=/; Max-Age={age}; HttpOnly; Secure; SameSite=Strict"

    def login(self, request, now):
        data = request.body()
        fields(data, {"username", "password"})
        username = text_field(data.get("username", ""), "username", 100)
        password = data.get("password", "")
        if not isinstance(password, str) or len(password) > 512:
            fail(400, "invalid_field", "Некорректное поле: password.")
        rate_key = self.digest("login-ip:" + (request.ip or "unknown"))
        def reserve(tx):
            if not self.rate_available(tx, "login:global", now, 100):
                return False
            if not self.rate(tx, "login:" + rate_key, now, 6, 900):
                return False
            return self.rate(tx, "login:global", now, 100, 900)
        if not self.atomic(reserve, now):
            fail(429, "rate_limited", "Слишком много попыток. Повторите через 15 минут.")
        encoded, principal, auth_tag = self.access.credentials(username, now)
        iterations, salt, expected = password_parts(encoded)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
        username_ok = principal is not None
        if not (hmac.compare_digest(actual, expected) and username_ok):
            # Audit contains a keyed IP identifier, never the password or raw IP.
            self.atomic(lambda tx: self.audit(tx, now, "auth.failed", details={"source": rate_key}, actor="unauthenticated"), now)
            fail(401, "invalid_credentials", "Неверный логин или пароль.")
        token, csrf_token = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        session = {"csrf": csrf_token, "createdAt": stamp(now), "_createdEpoch": now,
                   "authTag": auth_tag, "staffId": principal.get("id")}
        def save(tx):
            if request.token():
                tx.delete("sessions", self.digest("session:" + request.token()))
            tx.put("sessions", self.digest("session:" + token), session, now + SESSION_SECONDS)
            self.audit(tx, now, "auth.login", actor=principal["username"])
        self.atomic(save, now)
        return {"authenticated": True, "user": principal, "csrf": csrf_token}, self.cookie(token, SESSION_SECONDS)

    def settings_endpoint(self, request, now):
        if request.method == "GET":
            return self.atomic(lambda tx: public_record(self.settings(tx)), now)
        if request.method != "PATCH":
            fail(405, "method_not_allowed", "Метод не поддерживается.")
        data = request.body()
        fields(data, {"analyticsEnabled", "collectFullIp", "operationalNotes", "version"})
        def update(tx):
            old = self.settings(tx)
            self.check_version(data, old)
            result = dict(old)
            for key in ("analyticsEnabled", "collectFullIp"):
                if key in data:
                    result[key] = flag(data[key], key)
            if "operationalNotes" in data:
                result["operationalNotes"] = text_field(data["operationalNotes"], "operationalNotes", 2000)
            result.update(version=old["version"] + 1, updatedAt=stamp(now))
            tx.put("settings", "main", result, 9999999999)
            self.audit(tx, now, "settings.update", details={"fields": sorted(set(data) - {"version"})})
            return public_record(result)
        return self.atomic(update, now)

    @staticmethod
    def check_version(data, existing):
        if not isinstance(data.get("version"), int) or isinstance(data.get("version"), bool) or data["version"] != existing["version"]:
            fail(409, "version_conflict", "Запись изменена. Обновите её и повторите действие.")

    def validate_guest(self, data, now, existing=None):
        allowed = {"name", "phone", "email", "notes", "preferences", "skillNote", "skillVerified", "status", "version", "id"}
        fields(data, allowed)
        value = dict(existing or {"name": "", "phone": "", "email": "", "notes": "", "preferences": "",
                     "skillNote": "", "skillVerified": False, "skillVerifiedAt": None, "status": "active"})
        for key in ("name", "notes", "preferences", "skillNote"):
            if key in data:
                value[key] = text_field(data[key], key, 120 if key == "name" else 2000)
        if not value["name"]:
            fail(400, "guest_name_required", "Укажите имя или позывной гостя.")
        for key in ("phone", "email"):
            if key in data:
                value[key] = validate_contact(data[key], key)
        if "status" in data:
            if not isinstance(data["status"], str) or data["status"] not in {"active", "inactive"}:
                fail(400, "invalid_status", "Некорректный статус гостя.")
            value["status"] = data["status"]
        if "skillNote" in data and data["skillNote"] != (existing or {}).get("skillNote"):
            value["skillVerified"] = False
            value["skillVerifiedAt"] = None
        if "skillVerified" in data:
            value["skillVerified"] = flag(data["skillVerified"], "skillVerified")
            value["skillVerifiedAt"] = stamp(now) if value["skillVerified"] else None
        if value["skillVerified"] and not value["skillNote"]:
            fail(400, "skill_evidence_required", "Добавьте наблюдение инструктора перед подтверждением навыка.")
        return value

    def validate_booking(self, data, now, existing=None):
        fields(data, {"guestId", "guestName", "phone", "email", "startsAt", "duration", "tariff",
                      "participants", "vr", "vrCount", "status", "notes", "version", "id", "seatIds"})
        value = dict(existing or {"guestId": None, "guestName": "", "phone": "", "email": "",
                     "notes": "", "status": "draft", "duration": 60, "tariff": "standard", "participants": 1, "vr": False})
        for key in ("guestName", "notes"):
            if key in data:
                value[key] = text_field(data[key], key, 120 if key == "guestName" else 2000)
        for key in ("phone", "email"):
            if key in data:
                value[key] = validate_contact(data[key], key)
        if "guestId" in data:
            if data["guestId"] is not None and (not isinstance(data["guestId"], str) or not re.fullmatch(r"[a-f0-9-]{36}", data["guestId"])):
                fail(400, "invalid_guest", "Некорректный ID гостя.")
            value["guestId"] = data["guestId"]
        if "startsAt" in data:
            value["startsAt"] = parse_instant(data["startsAt"]).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        if not value.get("startsAt"):
            fail(400, "start_required", "Укажите начало визита.")
        if "duration" in data:
            value["duration"] = integer(data["duration"], "duration", 30, 120)
        if value["duration"] not in (30, 60, 120):
            fail(400, "invalid_duration", "Доступны 30, 60 или 120 минут.")
        if "tariff" in data:
            if not isinstance(data["tariff"], str) or data["tariff"] not in {*PRICES, "mixed"}:
                fail(400, "invalid_tariff", "Неизвестный тариф.")
            value["tariff"] = data["tariff"]
        if "participants" in data:
            value["participants"] = integer(data["participants"], "participants", 1, 10 if data.get("seatIds") or (existing or {}).get("seatIds") else 7)
        if "vr" in data:
            value["vr"] = flag(data["vr"], "vr")
        if "vrCount" in data:
            value["vrCount"] = integer(data["vrCount"], "vrCount", 0, value["participants"])
        elif "vr" in data or not existing:
            value["vrCount"] = value["participants"] if value["vr"] else 0
        else:
            value["vrCount"] = integer(value.get("vrCount", value["participants"] if value["vr"] else 0), "vrCount", 0, value["participants"])
        value["vr"] = value["vrCount"] > 0
        if 'seatIds' in data:
            value['seatIds']=data['seatIds']
            self.seats.price_selection(value,value['seatIds'])
        elif existing and any(value.get(k)!=existing.get(k) for k in ('tariff','participants')):
            for key in ('seatIds','seatLabels','_hostIds','items'):value.pop(key,None)
        if value.get('seatIds'):
            self.seats.price_selection(value,value['seatIds'])
        elif value['tariff']=='mixed':fail(400,'seats_required','Для разных комплектаций выберите конкретные места.')
        old_vr_count = (existing or {}).get("vrCount", (existing or {}).get("participants", 1) if (existing or {}).get("vr") else 0)
        def changed(key):
            return value.get(key) != (old_vr_count if key == "vrCount" else (existing or {}).get(key))
        start = parse_instant(value["startsAt"]).astimezone(CLUB_TZ)
        end = start + timedelta(minutes=value["duration"])
        minute = start.hour * 60 + start.minute
        shifted = minute + DAY // 60 if minute < 120 else minute
        if not 840 <= shifted < 1560 or shifted + value["duration"] > 1560 or start.second or start.microsecond:
            fail(400, "outside_hours", "Заезд должен целиком проходить между 14:00 и 02:00 по Оренбургу.")
        if "status" in data:
            if not isinstance(data["status"], str) or data["status"] not in {"draft", "confirmed", "cancelled", "completed"}:
                fail(400, "invalid_status", "Некорректный статус брони.")
            value["status"] = data["status"]
        old_status = existing["status"] if existing else "draft"
        transitions = {"draft": {"draft", "confirmed", "cancelled"}, "confirmed": {"confirmed", "cancelled", "completed"},
                       "cancelled": {"cancelled"}, "completed": {"completed"}}
        if not existing and value["status"] != "draft":
            fail(400, "draft_required", "Новая запись создаётся черновиком. Подтвердите её отдельным действием.")
        if value["status"] not in transitions[old_status]:
            fail(409, "invalid_transition", "Этот переход статуса недоступен.")
        if value["status"] == "confirmed" and (not existing or old_status != "confirmed"):
            if start.timestamp() <= now:
                fail(400, "past_confirmation", "Нельзя подтвердить уже начавшийся заезд.")
        if value["status"] == "confirmed" and (not value["guestName"] or not (value["phone"] or value["email"])):
            fail(400, "contact_required", "Для подтверждения нужны гость и способ связи.")
        if old_status == "confirmed" and value["status"] == "confirmed" and any(
                changed(key) for key in ("startsAt", "duration", "tariff", "participants", "vr", "vrCount", "seatIds")):
            if start.timestamp() <= now:
                fail(400, "past_modification", "Нельзя переносить подтверждённую бронь в прошлое.")
        if value["status"] == "completed" and end.timestamp() > now:
            fail(400, "future_completion", "Завершить можно только закончившийся заезд.")
        if existing and old_status in {"cancelled", "completed"} and any(
                changed(key) for key in
                ("startsAt", "duration", "tariff", "participants", "vr", "vrCount", "guestId", "guestName", "phone", "email", "seatIds")):
            fail(409, "closed_booking", "Закрытую запись нельзя переписать. Создайте новую.")
        value["endsAt"] = end.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        if value.get("seatIds"):
            self.seats.price_selection(value,value["seatIds"])
            return value
        base, vr = PRICES[value["tariff"]][value["duration"]], VR_PRICES[value["duration"]]
        value["basePricePerPersonRub"], value["vrPricePerPersonRub"] = base, vr
        value["priceWithVrPerPersonRub"] = base + vr
        value["pricePerPersonRub"] = base if not value["vrCount"] else base + vr if value["vrCount"] == value["participants"] else None
        value["priceRub"] = base * value["participants"] + vr * value["vrCount"]
        return value

    def crm(self, request, now, resource, record_id):
        if request.method == "GET":
            if record_id:
                record = self.atomic(lambda tx: tx.get(resource, record_id), now)
                if not record:
                    fail(404, "not_found", "Запись не найдена.")
                return 200, public_record(record)
            records = self.records_for(request, now, resource)
            return 200, self.paginate(records, request)
        if request.method not in {"POST", "PATCH", "DELETE"}:
            fail(405, "method_not_allowed", "Метод не поддерживается.")
        data = request.body()
        if request.method != "POST":
            record_id = record_id or data.get("id", "")
            if not isinstance(record_id, str) or not re.fullmatch(r"[a-f0-9-]{36}", record_id):
                fail(400, "invalid_id", "Некорректный ID записи.")
        elif record_id or "id" in data or "version" in data:
            fail(400, "server_identity", "ID и версию новой записи создаёт сервер.")
        new_id = str(uuid.uuid4())
        allocation = candidate = None
        if resource == 'bookings' and request.method != 'DELETE':
            original = self.atomic(lambda tx: tx.get(resource,record_id),now) if record_id else None
            if original:self.check_version(data,original)
            candidate = self.validate_booking(data,now,original)
            # Changing class/count requires a fresh seat assignment, never stale host IDs.
            if original and 'seatIds' not in data and any(candidate[k]!=original[k] for k in ('tariff','participants')):
                for key in ('seatIds','seatLabels','_hostIds'): candidate.pop(key,None)
            allocation=self.seats.preflight(candidate,now,record_id)
        def mutate(tx):
            existing = tx.get(resource, record_id) if record_id else None
            if request.method != "POST" and not existing:
                fail(404, "not_found", "Запись не найдена.")
            if existing:
                self.check_version(data, existing)
            if request.method == "DELETE":
                if resource=="bookings" and tx.get("ss_jobs","booking:"+record_id):
                    fail(409,"integrated_booking","Синхронизированную запись можно отменить, но нельзя удалить её историю.")
                fields(data, {"id", "version"})
                if resource == "guests" and tx.get("ss_links", record_id):
                    fail(409, "linked_profile", "Гость связан со SmartShell. Переведите карточку в неактивные вместо удаления.")
                if resource == "guests":
                    if existing.get('_memberId'):
                        fail(409, 'linked_profile', 'У гостя есть личный кабинет. Сохрани историю: переведи карточку в неактивные вместо удаления.')
                    # Remove linked copied contact data in the same transaction.
                    for booking in self.scan(tx, "bookings"):
                        if booking.get("guestId") == record_id:
                            booking.update(guestId=None, guestName="Удалённый гость", phone="", email="", notes="",
                                           version=booking["version"] + 1, updatedAt=stamp(now))
                            tx.put("bookings", booking["id"], booking, now + CRM_DAYS * DAY)
                            if booking.get('_memberId'):
                                self.members.queue(tx, booking, now)
                tx.delete("ss_booking_intents" if resource == "bookings" else "ss_profile_intents", record_id)
                tx.delete(resource, record_id)
                self.audit(tx, now, resource + ".delete", resource, record_id)
                return {"ok": True, "id": record_id}
            if resource == "guests":
                value = self.validate_guest(data, now, existing)
                if value.get('_memberId'):
                    user=tx.get('members',value['_memberId'])
                    if user:
                        value['name'] = text_field(value['name'], 'имя в профиле', 40, True)
                        user.update(name=value['name'],phone=value['phone'],version=user['version']+1,updatedAt=stamp(now))
                        tx.put('members',user['id'],user,now+365*DAY)
            else:
                if existing and existing.get('proposal') and data.get('status') == 'confirmed':
                    fail(409, 'proposal_pending', 'Гость ещё не согласовал предложенное время.')
                value = self.validate_booking(data, now, existing)
                if allocation:
                    value.update({k:candidate[k] for k in ('seatIds','seatLabels','_hostIds','allocationState')})
                    self.seats.price_selection(value, value['seatIds'])
                    self.seats.assert_free(tx,value,*allocation,now,record_id)
                if existing and existing.get('_memberId') and value.get('guestId') != existing.get('guestId'):
                    fail(409, 'member_booking_link', 'Заявку из кабинета нельзя привязать к другому гостю.')
                if value.get("guestId") and not tx.get("guests", value["guestId"]):
                    fail(400, "guest_not_found", "Указанный гость не найден.")
                guest=tx.get('guests',value['guestId']) if value.get('guestId') else None
                if guest and guest.get('_memberId'):
                    user=tx.get('members',guest['_memberId'])
                    if not user or user.get('disabled'): fail(409,'profile_unavailable','Профиль недоступен.')
                    value['_memberId']=user['id']
                    value.setdefault('source','admin_profile')
                    value.setdefault('reference','AS-'+secrets.token_hex(4).upper())
                    booking_id=existing['id'] if existing else new_id
                    tx.put('member_bookings:'+user['id'],booking_id,{'id':booking_id},now+CRM_DAYS*DAY)
                if value.get('_memberId') and existing and value['status'] != existing['status']:
                    value['ownerMessage'] = {'confirmed': 'Клуб одобрил выбранное время.' if self.smartshell.sync.enabled(tx.get('ss_config','main') or {}) else 'Клуб подтвердил запись. Ждём тебя!',
                        'cancelled': 'Запись отменена клубом. Позвони — подберём другой вариант.',
                        'completed': 'Спасибо за заезд. Увидимся на старте!'}.get(value['status'], '')
                    if value['status'] != 'draft':
                        value['proposal'] = None
            value.update(id=existing["id"] if existing else new_id,
                         version=existing["version"] + 1 if existing else 1,
                         createdAt=existing["createdAt"] if existing else stamp(now), updatedAt=stamp(now),
                         _createdEpoch=existing["_createdEpoch"] if existing else now)
            tx.put(resource, value["id"], value, now + CRM_DAYS * DAY)
            if resource == "bookings":
                self.smartshell.queue_booking(tx, value, now)
            if resource == 'bookings' and value.get('_memberId'):
                self.members.queue(tx, value, now)
            self.audit(tx, now, resource + (".update" if existing else ".create"), resource, value["id"],
                       {"fields": sorted(set(data) - {"version", "id"}), "status": value.get("status")})
            return public_record(value)
        return (201 if request.method == "POST" else 200), self.atomic(mutate, now)

    def period(self, request, now, max_days=90):
        today = datetime.fromtimestamp(now, CLUB_TZ).date()
        try:
            if request.query.get("from") or request.query.get("to"):
                end = date.fromisoformat(request.query.get("to") or today.isoformat())
                begin = date.fromisoformat(request.query.get("from") or (end - timedelta(days=6)).isoformat())
            else:
                period = request.query.get("period", "7d")
                days = {"today": 1, "1d": 1, "7d": 7, "30d": 30, "90d": 90}.get(period)
                if not days:
                    raise ValueError()
                begin, end = today - timedelta(days=days - 1), today
            if end < begin or (end - begin).days >= max_days or begin.year < 1971 or end.year > 2100:
                raise ValueError()
            since = int(datetime.combine(begin, datetime.min.time(), CLUB_TZ).timestamp())
            until = int(datetime.combine(end + timedelta(days=1), datetime.min.time(), CLUB_TZ).timestamp())
            return since, until, {"from": begin.isoformat(), "to": end.isoformat(), "timezone": "Asia/Yekaterinburg"}
        except (ValueError, TypeError):
            fail(400, "invalid_period", "Проверьте диапазон дат (не более 90 дней).")

    def records_for(self, request, now, resource):
        if resource in {"events", "audit"}:
            since, until, _ = self.period(request, now)
            records = self.atomic(lambda tx: self.scan(tx, resource, since, until), now)
        else:
            records = self.atomic(lambda tx: self.scan(tx, resource), now)
            if resource == "bookings" and (request.query.get("from") or request.query.get("to") or request.query.get("period")):
                since, until, _ = self.period(request, now)
                records = [record for record in records if since <= parse_instant(record["startsAt"]).timestamp() < until]
            search = str(request.query.get("search") or request.query.get("q") or "").strip().casefold()[:120]
            if search:
                keys = ("name", "phone", "email") if resource == "guests" else ("guestName", "phone", "email")
                records = [record for record in records if any(search in str(record.get(key, "")).casefold() for key in keys)]
            if request.query.get("status"):
                records = [record for record in records if record.get("status") == request.query["status"]]
        return sorted([public_record(row) for row in records], key=lambda row: row.get("createdAt", ""), reverse=True)

    @staticmethod
    def paginate(records, request):
        try:
            limit = min(500, max(1, int(request.query.get("limit", 100))))
            offset = max(0, int(request.query.get("offset", 0)))
        except (ValueError, TypeError):
            fail(400, "invalid_pagination", "Некорректная страница.")
        return {"items": records[offset:offset + limit], "total": len(records), "limit": limit,
                "offset": offset, "nextOffset": offset + limit if offset + limit < len(records) else None}

    def reporting_list(self, request, now):
        kind = request.path.rsplit("/", 1)[-1]
        if kind != "visitors":
            return self.paginate(self.records_for(request, now, kind), request)
        return self.paginate(self.visitors(request, now), request)

    def visitors(self, request, now):
        records = self.records_for(request, now, "events")
        visitors = {}
        for event in sorted(records, key=lambda item: item["createdAt"]):
            key = event["visitorId"]
            if key not in visitors:
                visitors[key] = {"visitorId": key, "sessions": set(), "eventCount": 0,
                    "firstSeen": event["createdAt"], "lastSeen": event["createdAt"],
                    "ip": event.get("ip"), "device": event["device"], "browser": event["browser"],
                    "referrer": event["referrer"], "utm": event["utm"]}
            row = visitors[key]
            row["sessions"].add(event["sessionId"])
            row["eventCount"] += 1
            row["lastSeen"] = event["createdAt"]
            row["ip"] = event.get("ip")
        for value in visitors.values():
            value["sessions"] = len(value["sessions"])
        return sorted(visitors.values(), key=lambda item: item["lastSeen"], reverse=True)

    def overview(self, request, now):
        since, until, period = self.period(request, now)
        def load(tx):
            return self.scan(tx, "events", since, until), self.scan(tx, "bookings"), self.scan(tx, "guests")
        events, bookings, guests = self.atomic(load, now)
        bookings = [item for item in bookings if since <= parse_instant(item["startsAt"]).timestamp() < until]
        views = [item for item in events if item["event"] == "page_view"]
        sessions = {item["sessionId"] for item in events}
        first = {}
        for item in sorted(events, key=lambda value: value["createdAt"]):
            first.setdefault(item["sessionId"], item)
        breakdown = lambda values: [{"label": key, "count": count} for key, count in Counter(values).most_common(25)]
        by_day = []
        day = date.fromisoformat(period["from"])
        last_day = date.fromisoformat(period["to"])
        while day <= last_day:
            match = lambda event: parse_instant(event["createdAt"]).astimezone(CLUB_TZ).date() == day
            day_events = [item for item in events if match(item)]
            by_day.append({"date": day.isoformat(), "visits": sum(item["event"] == "page_view" for item in day_events),
                           "sessions": len({item["sessionId"] for item in day_events})})
            day += timedelta(days=1)
        return {"period": period, "visits": len(views), "sessions": len(sessions),
            "consentedUsers": len({item["visitorId"] for item in events}),
            "callClicks": sum(item["event"] == "click" and item["target"] == "call" for item in events),
            "bookingIntents": sum(item["event"] == "booking_intent" for item in events),
            "confirmedBookings": sum(item["status"] == "confirmed" for item in bookings),
            "completedBookings": sum(item["status"] == "completed" for item in bookings),
            "cancelledBookings": sum(item["status"] == "cancelled" for item in bookings),
            "bookingsTotal": len(bookings), "guestsTotal": len(guests), "byDay": by_day,
            "referrers": breakdown(item["referrer"] or "Прямой переход" for item in first.values()),
            "devices": breakdown(item["device"] for item in first.values()),
            "browsers": breakdown(item["browser"] for item in first.values()),
            "utmCampaigns": breakdown(item["utm"].get("campaign", "Без кампании") for item in first.values()),
            "eventCounts": breakdown(item["event"] for item in events), "truncated": False,
            "analyticsRetentionDays": ANALYTICS_DAYS}

    @staticmethod
    def safe_referrer(value):
        if not isinstance(value, str) or len(value) > 2048:
            return ""
        try:
            parsed = urlsplit(value)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
                return ""
            return parsed.hostname.lower()[:200]
        except ValueError:
            return ""

    @staticmethod
    def safe_utm(value):
        result = {}
        if not isinstance(value, dict):
            return result
        for key in ("source", "medium", "campaign", "content", "term"):
            part = value.get(key, value.get("utm_" + key))
            if isinstance(part, str) and 0 < len(part) <= 80 and re.fullmatch(r"[\w .-]+", part, re.UNICODE) and not re.search(r"\d{7,}", part):
                result[key] = part
        return result

    @staticmethod
    def device_browser(user_agent):
        lower = user_agent.lower()
        device = "tablet" if "ipad" in lower or ("android" in lower and "mobile" not in lower) else "mobile" if "mobile" in lower else "desktop"
        browser = "Edge" if "edg" in lower else "Yandex" if "yabrowser" in lower else "Firefox" if "firefox" in lower else "Chrome" if "chrome" in lower or "crios" in lower else "Safari" if "safari" in lower else "Other"
        return device, browser

    def analytics(self, request, now):
        data = request.body()
        fields(data, {"sessionId", "visitorId", "event", "path", "referrer", "utm", "properties",
                      "consent", "consentVersion", "ipConsent"})
        if data.get("consent") is not True or data.get("consentVersion") not in {"2026-09-19", "2026-11-07"}:
            fail(400, "consent_required", "Для аналитики требуется явное согласие.")
        for key in ("sessionId", "visitorId"):
            if not isinstance(data.get(key), str) or not ID_RE.fullmatch(data[key]):
                fail(400, "invalid_identifier", "Некорректный идентификатор сессии.")
        if not isinstance(data.get("event"), str) or data["event"] not in EVENTS:
            fail(400, "unknown_event", "Неизвестное событие.")
        properties = data.get("properties", {})
        fields(properties, {"target", "section", "tariff", "mode"})
        clean_properties = {}
        for key, allowed in (("target", TARGETS), ("section", SECTIONS), ("tariff", set(PRICES)), ("mode", {"race", "drift", "rally", "free"})):
            if key in properties:
                if not isinstance(properties[key], str) or properties[key] not in allowed:
                    fail(400, "unknown_property", "Неизвестный параметр события.")
                clean_properties[key] = properties[key]
        if data["event"] == "click" and "target" not in clean_properties:
            fail(400, "target_required", "Не указан тип действия.")
        # A finite route set prevents personal data from being hidden in arbitrary URL paths.
        if not isinstance(data.get("path", "/"), str):
            fail(400, "invalid_path", "Некорректный адрес страницы.")
        try:
            path = urlsplit(data.get("path", "/")).path
        except (TypeError, ValueError):
            path = "/"
        if path not in {"/", "/index.html", "/privacy", "/privacy.html"}:
            fail(400, "private_path", "Этот адрес не отслеживается.")
        device, browser = self.device_browser(request.headers.get("user-agent", "")[:500])
        event_id = str(uuid.uuid4())
        value = {"id": event_id, "sessionId": data["sessionId"], "visitorId": data["visitorId"],
                 "event": data["event"], "target": clean_properties.get("target", ""), "properties": clean_properties,
                 "path": path, "referrer": self.safe_referrer(data.get("referrer", "")),
                 "utm": self.safe_utm(data.get("utm")), "device": device, "browser": browser,
                 "consentVersion": data["consentVersion"], "createdAt": stamp(now), "_createdEpoch": now}
        def ingest(tx):
            settings = self.settings(tx)
            if not settings["analyticsEnabled"]:
                return {"accepted": False, "reason": "disabled"}
            # A reached global budget must not create keys for rotating anonymous IDs/IPs.
            if not self.rate_available(tx, "analytics:global", now, 3000):
                return {"limited": True}
            ip_key = self.digest("analytics-ip:" + (request.ip or "unknown"))
            if not self.rate(tx, "analytics:" + ip_key, now, 180, 600):
                return {"limited": True}
            if not self.rate(tx, "analytics-session:" + self.digest(data["sessionId"]), now, 120, 600):
                return {"limited": True}
            if not self.rate(tx, "analytics:global", now, 3000, DAY):
                return {"limited": True}
            value["ip"] = request.ip if data.get("ipConsent") is True and settings["collectFullIp"] else None
            tx.put("events", event_id, value, now + ANALYTICS_DAYS * DAY)
            return {"accepted": True}
        result = self.atomic(ingest, now)
        if result.get("limited"):
            fail(429, "rate_limited", "Лимит событий временно исчерпан.")
        return result

    def export(self, request, now):
        resource = request.query.get("dataset") or request.query.get("resource")
        if resource not in {"events", "bookings", "guests", "audit", "visitors"}:
            fail(400, "invalid_dataset", "Неизвестный набор данных.")
        rows = self.visitors(request, now) if resource == "visitors" else self.records_for(request, now, resource)
        columns = {"events": ["createdAt", "visitorId", "sessionId", "event", "target", "path", "referrer", "device", "browser", "ip", "utm"],
            "bookings": ["id", "guestName", "phone", "email", "startsAt", "endsAt", "duration", "tariff", "participants", "vrCount", "status", "priceRub", "notes"],
            "visitors": ["visitorId", "sessions", "eventCount", "firstSeen", "lastSeen", "ip", "device", "browser", "referrer", "utm"],
            "guests": ["id", "name", "phone", "email", "status", "preferences", "skillNote", "skillVerified", "notes", "updatedAt"],
            "audit": ["createdAt", "action", "entity", "entityId", "actor", "details"]}[resource]
        output = io.StringIO(newline="")
        writer = csv.writer(output, delimiter=";", quoting=csv.QUOTE_ALL)
        writer.writerow(columns)
        for row in rows:
            writer.writerow([self.csv_cell(row.get(key, "")) for key in columns])
        self.atomic(lambda tx: self.audit(tx, now, "data.export", resource, details={"records": len(rows)}), now)
        return "\ufeff" + output.getvalue(), resource

    @staticmethod
    def csv_cell(value):
        if value is None:
            return ""
        if isinstance(value, (dict, list)):
            value = json.dumps(value, ensure_ascii=False)
        value = str(value)
        # Quoting CSV alone does not stop spreadsheet formulas, including whitespace prefixes.
        if value.lstrip(" \t\r\n").startswith(("=", "+", "-", "@")) or value.startswith(("\t", "\r", "\n")):
            value = "'" + value
        return value
