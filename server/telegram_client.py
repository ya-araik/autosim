"""Telegram transport: credentials stay server-side, errors never expose token URLs."""
import json
import os
import re
import ssl
import urllib.error
import urllib.request


class TelegramMessageMissing(RuntimeError):
    pass


def telegram(method, payload):
    token = os.environ.get('TELEGRAM_BOT_TOKEN', '')
    if not re.fullmatch(r'\d+:[A-Za-z0-9_-]{30,}', token):
        raise RuntimeError('TELEGRAM_BOT_TOKEN is missing or malformed')
    request = urllib.request.Request('https://api.telegram.org/bot' + token + '/' + method,
                                    data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    handlers = [urllib.request.HTTPSHandler(context=ssl.create_default_context())]
    proxy = os.environ.get('TELEGRAM_PROXY_URL', '')
    if proxy: handlers.append(urllib.request.ProxyHandler({'https': proxy}))
    try:
        with urllib.request.build_opener(*handlers).open(request, timeout=25) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        try: description = json.loads(error.read(4096)).get('description', '')
        except Exception: description = ''
        if method == 'editMessageText' and 'message is not modified' in description:
            return {'message_id': payload['message_id']}
        if method == 'editMessageText' and error.code == 400 and any(text in description for text in ('message to edit not found', "message can't be edited")):
            raise TelegramMessageMissing('The previous Telegram card is unavailable') from None
        raise RuntimeError('Telegram request failed (HTTP ' + str(error.code) + ')') from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise RuntimeError('Telegram connection unavailable') from None
    if not result.get('ok'): raise RuntimeError('Telegram rejected the request')
    return result['result']
