"""Create an installation's owner and secrets locally; no default password."""
import getpass
import os
from pathlib import Path
import re
import secrets
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from app import make_password_hash

root=Path(__file__).resolve().parents[1];target=root/'.env'
if target.exists(): raise SystemExit('.env already exists. Edit it intentionally; setup will not overwrite it.')
domain=input('Domain, e.g. club.example.ru: ').strip()
if not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?',domain) or '.' not in domain: raise SystemExit('Invalid domain')
username=input('Owner login [admin333]: ').strip() or 'admin333'
if not re.fullmatch(r'[A-Za-z0-9_.@-]{3,64}',username): raise SystemExit('Invalid login')
password=getpass.getpass('New owner password (12+ characters): ')
if len(password)<12 or password!=getpass.getpass('Repeat password: '): raise SystemExit('Password too short or mismatch')
source=getpass.getpass('Source download password (empty = disabled): ')
values={'DOMAIN':domain,'ADMIN_USERNAME':username,'ADMIN_PASSWORD_HASH':make_password_hash(password),
        'SESSION_SECRET':secrets.token_urlsafe(48),'ALLOWED_ORIGINS':'https://'+domain,'DATABASE_PATH':'/data/autosim.sqlite3',
        'TRUST_REVERSE_PROXY':'1','SMARTSHELL_WRITE_CLUB_ID':'','BOOKING_BRIDGE_SECRET':secrets.token_urlsafe(48),
        'BOOKING_OWNER_ID':'','TELEGRAM_OWNER_IDS':'','TELEGRAM_BOT_TOKEN':'','TELEGRAM_ADMIN_CHAT_ID':'','TELEGRAM_UPDATE_MODE':'polling','TELEGRAM_WEBHOOK_SECRET':secrets.token_urlsafe(48),'TELEGRAM_PROXY_URL':'',
        'SOURCE_PASSWORD_HASH':make_password_hash(source) if source else ''}
fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w',encoding='utf-8') as stream:
    for key,value in values.items(): stream.write(key+"='"+value+"'\n")
print('Created private .env. Owner: '+username+'. Start: docker compose up -d --build')
