"""Local site and SQLite API; run with .venv/bin/python scripts/local-server.py."""
import mimetypes
import os
from pathlib import Path
import shlex
import ssl
import sys
from socketserver import ThreadingMixIn
from wsgiref.simple_server import WSGIServer, make_server
from wsgiref.util import FileWrapper

ROOT = Path(__file__).resolve().parents[1]
for line in (ROOT / '.env').read_text().splitlines():
    if line.strip() and not line.lstrip().startswith('#'):
        key, value = line.split('=', 1)
        parts = shlex.split(value)
        os.environ[key] = parts[0] if parts else ''
sys.path.insert(0, str(ROOT / 'server'))
from wsgi import application as api

PUBLIC = ROOT / 'public'
ALIASES = {'/': '/index.html', '/cabinet': '/cabinet.html',
           '/adminka': '/adminka.html', '/source': '/source.html'}


def application(environ, start_response):
    path = environ.get('PATH_INFO', '/')
    if path.startswith('/api/'):
        return api(environ, start_response)
    if path.rstrip('/') in ('/apple', '/apple.html'):
        start_response('308 Permanent Redirect', [('Location', '/')])
        return []
    path = ALIASES.get(path.rstrip('/') or '/', path)
    target = (PUBLIC / path.lstrip('/')).resolve()
    if not target.is_relative_to(PUBLIC) or not target.is_file():
        start_response('404 Not Found', [('Content-Type', 'text/plain')])
        return [b'Not found']
    if environ['REQUEST_METHOD'] not in ('GET', 'HEAD'):
        start_response('405 Method Not Allowed', [('Allow', 'GET, HEAD')])
        return []
    content_type = mimetypes.guess_type(target)[0] or 'application/octet-stream'
    start_response('200 OK', [('Content-Type', content_type),
                             ('Content-Length', str(target.stat().st_size)),
                             ('X-Content-Type-Options', 'nosniff')])
    return [] if environ['REQUEST_METHOD'] == 'HEAD' else FileWrapper(target.open('rb'))


class LocalServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True


if __name__ == '__main__':
    with make_server('127.0.0.1', 4178, application, server_class=LocalServer) as server:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(ROOT / '.runtime/localhost.crt', ROOT / '.runtime/localhost.key')
        server.socket = context.wrap_socket(server.socket, server_side=True)
        print('AUTOSIM: https://localhost:4178 | Admin: https://localhost:4178/adminka', flush=True)
        server.serve_forever()
