"""Switch the existing TLS proxy to the new site; preserve old lead handling."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / '.runtime/cutover'
COMPOSE = ['docker', 'compose', '-p', 'autosim-new', '-f', 'compose.yaml', '-f', 'compose.live.yaml']


def run(args, capture=False):
    return subprocess.check_output(args, cwd=ROOT, text=True) if capture else subprocess.run(args, cwd=ROOT, check=True)


def inspect(name):
    return json.loads(run(['docker', 'inspect', name], True))[0]


def container(service):
    names = run(['docker', 'ps', '--filter', 'label=com.docker.compose.project=autosim-prod', '--filter', 'label=com.docker.compose.service=' + service, '--format', '{{.Names}}'], True).splitlines()
    if len(names) != 1:
        raise RuntimeError('Expected one running legacy service: ' + service)
    return names[0]


def private_write(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(data)


def restore_site(state):
    # Preserve the bind-mounted inode.
    Path(state['config']).write_bytes((STATE / 'nginx.before.conf').read_bytes())
    run(['docker', 'exec', state['nginx'], 'nginx', '-t'])
    run(['docker', 'exec', state['nginx'], 'nginx', '-s', 'reload'])


def main():
    os.chdir(ROOT)
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    state_file = STATE / 'state.json'
    if len(sys.argv) > 1 and sys.argv[1] == 'rollback':
        state=json.loads(state_file.read_text())
        restore_site(state)
        state['siteRolledBack']=True
        private_write(state_file,json.dumps(state))
        print('Old website restored. New worker remains active for BOTH old and new lead cards.')
        return
    if state_file.exists() and json.loads(state_file.read_text()).get('live'):
        state=json.loads(state_file.read_text())
        if state.get('siteRolledBack'):
            raise RuntimeError('Website was rolled back; bot still handles both stores. Review before another cutover.')
        print('Already switched. For rollback: python3 scripts/switch-live.py rollback')
        return
    nginx, old_app, poller = container('nginx'), container('autosim'), container('telegram-poller')
    mounts = inspect(nginx)['Mounts']
    config = next((m['Source'] for m in mounts if m['Destination'] == '/etc/nginx/conf.d/default.conf'), None)
    if not config or not Path(config).is_file():
        raise RuntimeError('Cannot locate the existing Nginx bind-mounted config')
    original = Path(config).read_text()
    if original.count('proxy_pass http://autosim_app;') != 1:
        raise RuntimeError('Nginx routing differs from expected; no changes made')
    env = dict(value.split('=', 1) for value in inspect(old_app)['Config']['Env'] if '=' in value)
    required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID', 'TELEGRAM_WEBHOOK_SECRET']
    if any(not env.get(key) for key in required):
        raise RuntimeError('Legacy bot configuration incomplete')
    # JSON quoting is accepted by Compose dotenv; secrets never enter Git or logs.
    settings = {key: env[key] for key in required[:2]}
    settings['TELEGRAM_PROXY_URL'] = env.get('TELEGRAM_PROXY_URL', '')
    settings['LEGACY_TELEGRAM_WEBHOOK_SECRET'] = env['TELEGRAM_WEBHOOK_SECRET']
    private_write(ROOT / '.env.cutover', ''.join(key + '=' + json.dumps(value) + '\n' for key, value in settings.items()))
    state = {'nginx': nginx, 'config': config, 'poller': poller, 'live': False}
    private_write(STATE / 'nginx.before.conf', original)
    private_write(state_file, json.dumps(state))
    print('Building new services; old website and bot remain available.', flush=True)
    run(COMPOSE + ['build', 'app', 'worker'])
    run(COMPOSE + ['up', '-d', 'app', 'gateway'])
    run(COMPOSE + ['exec', '-T', 'gateway', 'nginx', '-t'])
    for attempt in range(30):
        try:
            reply = run(['docker', 'exec', nginx, 'wget', '-qO-', 'http://autosim-new-web:8080/api/admin/session'], True)
            if json.loads(reply).get('authenticated') is False:
                break
        except (subprocess.CalledProcessError, ValueError):
            pass
        time.sleep(1)
    else:
        raise RuntimeError('New API is not reachable; old website remains active')
    # Read-only Telegram checks plus an empty authenticated legacy webhook request.
    check = "from telegram_client import telegram; from legacy_telegram import forward_legacy_update; telegram('getMe',{}); assert not telegram('getWebhookInfo',{}).get('url'), 'Active webhook: stop cutover'; forward_legacy_update({'update_id':0},False); print('Telegram and legacy handler reachable')"
    run(COMPOSE + ['run', '--rm', '--no-deps', 'worker', 'python', '-c', check])
    # Snapshot SQLite before background delivery starts. It stays on the server.
    snapshot = "import sqlite3,time; p='/data/before-cutover-'+str(int(time.time()))+'.sqlite3'; sqlite3.connect('/data/autosim.sqlite3').backup(sqlite3.connect(p)); print('SQLite backup created')"
    run(COMPOSE + ['exec', '-T', 'app', 'python', '-c', snapshot])
    stopped = False
    try:
        run(['docker', 'stop', poller]); stopped = True
        run(COMPOSE + ['up', '-d', '--no-deps', 'worker'])
        time.sleep(15)
        worker = run(COMPOSE + ['ps', '-q', 'worker'], True).strip()
        status = inspect(worker)
        if not status['State']['Running'] or status['RestartCount']:
            raise RuntimeError('Worker did not stay running')
        logs = run(['docker', 'logs', '--tail', '20', worker], True)
        if 'Background task failed' in logs or 'Telegram worker ready: polling' not in logs:
            raise RuntimeError('Worker reported an error; keeping old site')
        new_config = ('upstream autosim_new_web {\n    zone autosim_new_web 64k;\n    server autosim-new-web:8080 resolve;\n    keepalive 16;\n}\n\n' + original.replace('proxy_pass http://autosim_app;', 'proxy_pass http://autosim_new_web;'))
        Path(config).write_text(new_config)
        run(['docker', 'exec', nginx, 'nginx', '-t'])
        run(['docker', 'exec', nginx, 'nginx', '-s', 'reload'])
        time.sleep(2)
        html = run(['curl', '--fail', '--silent', '--show-error', '--max-time', '15', '--resolve', 'auto-sim.ru:443:127.0.0.1', 'https://auto-sim.ru/'], True)
        if 'callback-banner-title' not in html:
            raise RuntimeError('Public HTTPS check returned unexpected page')
        state['live'] = True
        private_write(state_file, json.dumps(state))
    except Exception:
        restore_site(state)
        if stopped:
            run(COMPOSE + ['stop', 'worker'])
            run(['docker', 'start', poller])
        raise
    print('LIVE: https://auto-sim.ru/ — new website. Telegram: one new poller, old cards forwarded to old backend.')
    print('Website rollback: python3 scripts/switch-live.py rollback')


if __name__ == '__main__':
    main()
