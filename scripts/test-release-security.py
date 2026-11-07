import importlib.util,json,os,sys,tempfile,unittest,concurrent.futures
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from app import Application,Config,make_password_hash,Request,ApiError
from storage import MemoryStore
from sqlite_store import SQLiteStore
from source_release import COOKIE

ORIGIN='https://release.example.test'
HASH=make_password_hash('fixture-only-secret',iterations=200000)

class ReleaseSecurity(unittest.TestCase):
    def setUp(self):
        self.now=1800000000
        self.app=Application(Config('fixture-owner',HASH,'fixture-session-secret-at-least-32-chars',(ORIGIN,)),MemoryStore(),lambda:self.now)
        self.env=patch.dict(os.environ,{'SOURCE_PASSWORD_HASH':HASH});self.env.start();self.addCleanup(self.env.stop)
    def call(self,path,body=None,method='POST',headers=None):
        return self.app.handle({'path':path,'httpMethod':method,'headers':{'origin':ORIGIN,'content-type':'application/json',**(headers or {})},'body':json.dumps(body or {}),'requestContext':{'identity':{'sourceIp':'203.0.113.9'}}})
    def test_source_password_not_client_authorization_and_expiry(self):
        event={'path':'/api/source/download','httpMethod':'GET','headers':{}}
        self.assertFalse(self.app.source_release.authorize(event,self.now)['isAuthorized'])
        result=self.call('/api/source/login',{'password':'fixture-only-secret'})
        self.assertEqual(result['statusCode'],200)
        cookie=result['headers']['Set-Cookie'];self.assertIn('HttpOnly; Secure; SameSite=Strict',cookie)
        event['headers']['cookie']=cookie.split(';')[0]
        self.assertTrue(self.app.source_release.authorize(event,self.now)['isAuthorized'])
        self.assertFalse(self.app.source_release.authorize(event,self.now+601)['isAuthorized'])
        event['path']='/other';self.assertFalse(self.app.source_release.authorize(event,self.now)['isAuthorized'])
    def test_source_origin_unknown_fields_limits_and_direct_download(self):
        self.assertEqual(self.call('/api/source/login',{'password':'fixture-only-secret'},headers={'origin':'https://evil.test'})['statusCode'],403)
        self.assertEqual(self.call('/api/source/login',{'password':'fixture-only-secret','admin':True})['statusCode'],400)
        self.assertEqual(self.call('/api/source/download',method='GET')['statusCode'],404)
        for _ in range(5):self.assertEqual(self.call('/api/source/login',{'password':"' OR 1=1--"})['statusCode'],401)
        self.assertEqual(self.call('/api/source/login',{'password':'fixture-only-secret'})['statusCode'],429)
    def test_duplicate_json_deep_json_and_unused_methods(self):
        for raw in ['{"username":"a","username":"b"}','{"a":'+('['*1500)+'0'+(']'*1500)+'}']:
            with self.assertRaises(ApiError) as caught:Request({'headers':{'content-type':'application/json'},'body':raw}).body()
            self.assertEqual(caught.exception.status,400)
        self.assertEqual(self.call('/api/admin/settings',method='PUT')['statusCode'],405)
    def test_sqlite_parameterization_rollback_and_serialization(self):
        with tempfile.TemporaryDirectory() as directory:
            store=SQLiteStore(Path(directory)/'data.sqlite3');malicious="'; DROP TABLE records;--"
            store.atomic(lambda tx:tx.put('test',malicious,{'value':'<script>alert(1)</script>'},9999999999),self.now)
            self.assertEqual(store.atomic(lambda tx:tx.get('test',malicious),self.now)['value'],'<script>alert(1)</script>')
            def broken(tx):tx.delete('test',malicious);raise ValueError()
            with self.assertRaises(ValueError):store.atomic(broken,self.now)
            self.assertIsNotNone(store.atomic(lambda tx:tx.get('test',malicious),self.now))
            def increment(_):
                def run(tx):
                    current=tx.get('count','one') or {'n':0};current['n']+=1;tx.put('count','one',current,9999999999)
                store.atomic(run,self.now)
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(increment,range(20)))
            self.assertEqual(store.atomic(lambda tx:tx.get('count','one'),self.now)['n'],20)

if __name__=='__main__':unittest.main(verbosity=2)
