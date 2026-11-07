"""Password-protected source delivery. The archive is never in public/."""
import hashlib
import hmac
import os
import re
import secrets
from http.cookies import SimpleCookie
from app import fail, fields, password_parts

COOKIE = '__Host-autosim_source'
LIFETIME = 600


class SourceRelease:
    def __init__(self, app):
        self.app = app

    def valid(self, token, now):
        if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
            return False
        return bool(self.app.atomic(lambda tx: tx.get('source_sessions', self.app.digest('source:'+token)), now))

    @staticmethod
    def token(headers):
        try:
            cookie = SimpleCookie(headers.get('cookie', ''))
            return cookie[COOKIE].value if COOKIE in cookie else ''
        except Exception:
            return ''

    def authorize(self, event, now):
        # Only the exact archive endpoint and the gateway's private IAM invocation.
        if event.get('path') != '/api/source/download' or event.get('httpMethod') not in ('GET', 'HEAD'):
            return {'isAuthorized': False}
        headers = {str(k).lower(): str(v) for k,v in (event.get('headers') or {}).items()}
        token = self.token(headers)
        if not token and isinstance(event.get('cookies'), dict):
            token = event['cookies'].get(COOKIE, '')
        return {'isAuthorized': self.valid(token, now)}

    def handle(self, request, now):
        if request.path == '/api/source/session' and request.method == 'GET':
            return self.app.response(request, 200, {'authenticated': self.valid(self.token(request.headers), now)})
        if request.path != '/api/source/login' or request.method != 'POST':
            fail(404, 'not_found', 'Ресурс не найден.')
        self.app.check_origin(request, required=True)
        data = request.body(); fields(data, {'password'})
        supplied = data.get('password')
        if not isinstance(supplied, str) or not 1 <= len(supplied) <= 128:
            fail(400, 'invalid_password', 'Введи пароль.')
        encoded = os.environ.get('SOURCE_PASSWORD_HASH', '')
        if not encoded:
            fail(503, 'source_unavailable', 'Скачивание пока недоступно.')
        def reserve(tx):
            if not self.app.rate_available(tx, 'source:global', now, 60): return False
            if not self.app.rate(tx, self.app.digest('source-ip:'+(request.ip or 'unknown')), now, 5, 900): return False
            return self.app.rate(tx, 'source:global', now, 60, 900)
        if not self.app.atomic(reserve, now):
            fail(429, 'rate_limited', 'Слишком много попыток. Повтори через 15 минут.')
        iterations, salt, expected = password_parts(encoded)
        actual = hashlib.pbkdf2_hmac('sha256', supplied.encode(), salt, iterations)
        if not hmac.compare_digest(actual, expected):
            fail(401, 'invalid_password', 'Неверный пароль.')
        token = secrets.token_urlsafe(32)
        old = self.token(request.headers)
        def save(tx):
            if old: tx.delete('source_sessions', self.app.digest('source:'+old))
            tx.put('source_sessions', self.app.digest('source:'+token), {'createdAt':now}, now+LIFETIME)
        self.app.atomic(save, now)
        return self.app.response(request, 200, {'authenticated': True, 'download':'/api/source/download'},
            {'Set-Cookie': f'{COOKIE}={token}; Path=/; Max-Age={LIFETIME}; HttpOnly; Secure; SameSite=Strict'})
