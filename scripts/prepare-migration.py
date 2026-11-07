"""Copy the running site's Telegram configuration into a new private installation."""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
from app import make_password_hash


def docker(*args):
    try:
        return subprocess.run(['docker', *args], check=True, capture_output=True, text=True, timeout=30).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        raise SystemExit('Не удалось прочитать контейнер Docker. Проверь его имя и доступ к Docker.') from None


def configuration(old, username, password, domain=None):
    domain = domain or urlsplit(old.get('NEXT_PUBLIC_SITE_URL', 'https://auto-sim.ru')).hostname
    if not domain or not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?', domain) or '.' not in domain:
        raise ValueError('Некорректный домен. Укажи --domain auto-sim.ru.')
    token = old.get('TELEGRAM_BOT_TOKEN', '').strip()
    chat = old.get('TELEGRAM_ADMIN_CHAT_ID', '').strip()
    if not re.fullmatch(r'\d+:[A-Za-z0-9_-]{30,}', token):
        raise ValueError('В выбранном контейнере нет корректного TELEGRAM_BOT_TOKEN.')
    if not re.fullmatch(r'-?[1-9]\d{4,19}', chat):
        raise ValueError('В выбранном контейнере нет корректного TELEGRAM_ADMIN_CHAT_ID.')
    if not re.fullmatch(r'[A-Za-z0-9_.@-]{3,64}', username) or len(password) < 12:
        raise ValueError('Логин: 3–64 символа; пароль: от 12 символов.')
    owner = chat if not chat.startswith('-') else ''
    values = {
        'DOMAIN': domain, 'ADMIN_USERNAME': username, 'ADMIN_PASSWORD_HASH': make_password_hash(password),
        'SESSION_SECRET': secrets.token_urlsafe(48), 'ALLOWED_ORIGINS': 'https://' + domain,
        'DATABASE_PATH': '/data/autosim.sqlite3', 'TRUST_REVERSE_PROXY': '1',
        'SMARTSHELL_WRITE_CLUB_ID': '', 'BOOKING_BRIDGE_SECRET': secrets.token_urlsafe(48),
        'BOOKING_OWNER_ID': owner, 'TELEGRAM_OWNER_IDS': owner,
        'TELEGRAM_BOT_TOKEN': token, 'TELEGRAM_ADMIN_CHAT_ID': chat,
        'TELEGRAM_PROXY_URL': old.get('TELEGRAM_PROXY_URL', '').strip(),
        'TELEGRAM_WEBHOOK_SECRET': secrets.token_urlsafe(48),
        # Keep the existing receiver active until its data and routing are migrated.
        'TELEGRAM_UPDATE_MODE': 'disabled', 'SOURCE_PASSWORD_HASH': ''
    }
    if any(any(c in value for c in "\r\n'\x00") for value in values.values()):
        raise ValueError('Неподдерживаемые символы в конфигурации; .env не создан.')
    return values


def write_env(target, values):
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        for key, value in values.items(): stream.write(key + "='" + value + "'\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', help='Имя или ID работающего Next.js-контейнера')
    parser.add_argument('--domain', help='Домен без https://; по умолчанию из старой конфигурации')
    args = parser.parse_args()
    target = ROOT / '.env'
    if target.exists(): raise SystemExit('.env уже существует. Скрипт не перезаписывает настройки.')
    container = args.container
    if not container:
        matches = docker('ps', '--filter', 'label=com.docker.compose.service=autosim', '--format', '{{.ID}}').splitlines()
        if len(matches) != 1: raise SystemExit('Не найден единственный контейнер сайта. Укажи --container ИМЯ.')
        container = matches[0]
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', container): raise SystemExit('Некорректное имя контейнера.')
    try:
        entries = json.loads(docker('inspect', '--format', '{{json .Config.Env}}', container))
        old = dict(entry.split('=', 1) for entry in entries if '=' in entry)
    except (ValueError, TypeError): raise SystemExit('Не удалось прочитать настройки контейнера.') from None
    username = input('Логин новой админки [admin333]: ').strip() or 'admin333'
    password = getpass.getpass('Новый пароль админки (от 12 символов): ')
    if password != getpass.getpass('Повтори пароль: '): raise SystemExit('Пароли не совпадают; .env не создан.')
    try:
        values = configuration(old, username, password, args.domain)
        write_env(target, values)
    except FileExistsError: raise SystemExit('.env уже создан другим процессом; перезапись отменена.') from None
    except ValueError as error: raise SystemExit(str(error)) from None
    print('Готово: приватный .env создан. Настройки Telegram скопированы, секреты не выведены.')
    print('Домен: ' + values['DOMAIN'] + '. Логин новой админки: ' + username)
    print('Новый получатель Telegram отключён. Старый сайт и бот не изменены.')
    if not values['BOOKING_OWNER_ID']: print('Чат бота — группа. Для уведомлений о бронированиях потребуется отдельный Telegram ID владельца.')
    if values['TELEGRAM_PROXY_URL']: print('Перенесён прокси Telegram. Перед запуском нужно подключить новый worker к сети существующего прокси.')
    print('Следующий шаг: docker compose -p autosim-new build app worker')


if __name__ == '__main__': main()
