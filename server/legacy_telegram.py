"""Keep old lead cards usable while the new worker owns Telegram polling."""
import json
import os
import urllib.request


def forward_legacy_update(item, handled):
    url = os.environ.get('LEGACY_TELEGRAM_WEBHOOK_URL', '')
    if not url:
        return
    text = (item.get('message') or {}).get('text', '').strip()
    command = text.split()[0].split('@')[0].lower() if text else ''
    # Lists/retry include both stores; cards and replies have one owning backend.
    if handled and command not in ('/new', '/active', '/done', '/retry_failed'):
        return
    if url != 'http://autosim:3000/api/telegram/webhook':
        raise RuntimeError('Unexpected legacy webhook destination')
    secret = os.environ.get('LEGACY_TELEGRAM_WEBHOOK_SECRET', '')
    if not secret:
        raise RuntimeError('Legacy webhook secret missing')
    request = urllib.request.Request(url, data=json.dumps(item).encode(), headers={
        'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret})
    # Internal Docker traffic must not use the public Telegram proxy.
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=20) as response:
        if not json.load(response).get('ok'):
            raise RuntimeError('Legacy Telegram handler did not acknowledge update')
