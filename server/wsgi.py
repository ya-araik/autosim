"""Production server adapter. Run behind the supplied HTTPS reverse proxy."""
import os
from pathlib import Path
from http import HTTPStatus
from urllib.parse import parse_qs
from wsgiref.util import FileWrapper
from app import Application, Config
from sqlite_store import SQLiteStore

config=Config(os.environ['ADMIN_USERNAME'],os.environ['ADMIN_PASSWORD_HASH'],os.environ['SESSION_SECRET'],
    tuple(x.strip().rstrip('/') for x in os.environ['ALLOWED_ORIGINS'].split(',')),
    booking_secret=os.environ.get('BOOKING_BRIDGE_SECRET',''),booking_owner_id=os.environ.get('BOOKING_OWNER_ID',''))
app=Application(config,SQLiteStore(os.environ.get('DATABASE_PATH','/data/autosim.sqlite3')))


def application(environ,start_response):
    headers={k[5:].replace('_','-').lower():v for k,v in environ.items() if k.startswith('HTTP_')}
    headers['content-type']=environ.get('CONTENT_TYPE','')
    path=environ.get('PATH_INFO','/');method=environ.get('REQUEST_METHOD','GET')
    if path=='/api/source/download' and method in ('GET','HEAD'):
        if not app.source_release.valid(app.source_release.token(headers),int(app.clock())):
            start_response('403 Forbidden',[('Content-Type','text/plain'),('Cache-Control','no-store')]);return [b'Access denied']
        archive=Path(os.environ.get('SOURCE_ARCHIVE_PATH','/releases/autosim-source.zip'))
        if not archive.is_file():
            start_response('404 Not Found',[('Content-Type','text/plain'),('Cache-Control','no-store')]);return [b'Archive unavailable']
        start_response('200 OK',[('Content-Type','application/zip'),('Content-Length',str(archive.stat().st_size)),('Content-Disposition','attachment; filename="autosim-source.zip"'),('Cache-Control','no-store'),('X-Content-Type-Options','nosniff')])
        return [] if method=='HEAD' else FileWrapper(archive.open('rb'))
    try: length=int(environ.get('CONTENT_LENGTH') or '0')
    except ValueError: length=-1
    if not 0<=length<=24000:
        start_response('413 Payload Too Large',[('Content-Type','text/plain')]);return [b'Request too large']
    try: body=environ['wsgi.input'].read(length).decode('utf-8')
    except UnicodeError:
        start_response('400 Bad Request',[('Content-Type','text/plain')]);return [b'Invalid UTF-8']
    # This header is overwritten by Caddy; the app port is not exposed to the host.
    ip=headers.get('x-autosim-client-ip') if os.environ.get('TRUST_REVERSE_PROXY')=='1' else environ.get('REMOTE_ADDR')
    event={'httpMethod':method,'path':path,'headers':headers,'body':body,'queryStringParameters':{k:v[-1] for k,v in parse_qs(environ.get('QUERY_STRING','')).items()},'requestContext':{'identity':{'sourceIp':ip}}}
    result=app.handle(event)
    start_response(str(result['statusCode'])+' '+HTTPStatus(result['statusCode']).phrase,list(result['headers'].items()))
    return [result['body'].encode('utf-8')]
