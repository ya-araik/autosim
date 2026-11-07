"""Standalone HTTP + worker regressions; all contacts are fictional fixtures."""
import importlib.util,io,json,os,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from app import make_password_hash
ROOT=Path(__file__).resolve().parents[1]
class Portable(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory();cls.env=patch.dict(os.environ,{'ADMIN_USERNAME':'fixture-owner','ADMIN_PASSWORD_HASH':make_password_hash('fixture-only-secret'),'SESSION_SECRET':'fixture-session-secret-at-least-32-characters','ALLOWED_ORIGINS':'https://fixture.example.test','DATABASE_PATH':str(Path(cls.temp.name)/'db.sqlite3'),'BOOKING_BRIDGE_SECRET':'fixture-bridge-secret-at-least-32-characters','BOOKING_OWNER_ID':'123456789'})
        cls.env.start();import wsgi;cls.http=wsgi
        spec=importlib.util.spec_from_file_location('worker',ROOT/'scripts/worker.py');cls.worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.worker)
    @classmethod
    def tearDownClass(cls):cls.env.stop();cls.temp.cleanup()
    def request(self,path,body=b'',method='POST',**extra):
        captured=[];env={'PATH_INFO':path,'REQUEST_METHOD':method,'CONTENT_LENGTH':str(len(body)),'CONTENT_TYPE':'application/json','wsgi.input':io.BytesIO(body),'REMOTE_ADDR':'203.0.113.1',**extra}
        result=b''.join(self.http.application(env,lambda status,headers:captured.append((status,headers))))
        return captured[0][0],result
    def test_auth_and_private_archive(self):
        self.assertTrue(self.request('/api/admin/overview',method='GET')[0].startswith('401'))
        self.assertTrue(self.request('/api/source/download',method='GET')[0].startswith('403'))
        self.assertTrue(self.request('/api/admin/login',b'{"username":"fixture-owner","password":"fixture-only-secret"}',HTTP_ORIGIN='https://evil.test')[0].startswith('403'))
        self.assertTrue(self.request('/api/admin/login',b'x'*24001)[0].startswith('413'))
        self.assertTrue(self.request('/api/admin/login',b'\xff')[0].startswith('400'))
    def test_worker_card_missing_optional_seats(self):
        card={'id':'12345678-1234-4234-8234-123456789abc','version':1,'status':'confirmed','guestName':'Fixture','phone':'+70000000000','startsAt':'2026-12-01T10:00:00Z','duration':60,'priceRub':650,'seatLabels':None,'ownerMessage':None}
        result=self.worker.card(card);buttons=[b for row in result['reply_markup']['inline_keyboard'] for b in row]
        self.assertTrue(any(b['text']=='Другое время' for b in buttons))
        self.assertTrue(all(len(b.get('callback_data','').encode())<=64 for b in buttons))
        calls=[];cb={'callback_query':{'id':'q','from':{'id':123456789},'message':{'message_id':1,'chat':{'id':123456789,'type':'private'}},'data':'asb:p:'+card['id']+':1'}}
        with patch.object(self.worker,'telegram',side_effect=lambda method,payload:calls.append(method) or {'message_id':2}),patch.object(self.worker,'bridge',return_value={'card':card}) as bridge:
            self.worker.update(cb,['123456789']);self.assertIn('sendMessage',calls);self.assertEqual(bridge.call_args[0][0],'prompt')
            calls.clear();cb['callback_query']['from']['id']=987654321;self.worker.update(cb,['123456789']);self.assertFalse(calls)
if __name__=='__main__':unittest.main(verbosity=2)
