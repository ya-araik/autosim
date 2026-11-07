"""Offline RBAC and SmartShell safety tests. No real token or live network."""
import importlib.util
import json
import unittest
import uuid
from pathlib import Path
spec=importlib.util.spec_from_file_location('admin_tests',Path(__file__).with_name('test-admin-backend.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
from smartshell import RemoteError, AUTH_LOGIN, AUTH_REFRESH


class IntegrationTest(unittest.TestCase):
    setUp=base.ApiTests.setUp
    call=base.ApiTests.call
    login=base.ApiTests.login
    create_booking=base.ApiTests.create_booking

    def owner(self):
        self.assertEqual(self.login()[0],200)
        self.owner_cookie,self.owner_csrf=self.cookie,self.csrf

    def as_owner(self):
        self.cookie,self.csrf=self.owner_cookie,self.owner_csrf

    def role(self,permissions):
        code,data,_=self.call('/api/admin/access','POST',{'kind':'role','name':'Смена','permissions':permissions})
        self.assertEqual(code,200,data)
        return data['id']

    def staff(self,role_id):
        code,data,_=self.call('/api/admin/access','POST',{'kind':'staff','name':'Тест','username':'shift_admin',
                              'password':'TestStaff!12','roleId':role_id,'disabled':False})
        self.assertEqual(code,200,data)
        return data['id']

    def staff_login(self):
        code,data,r=self.call('/api/admin/login','POST',{'username':'shift_admin','password':'TestStaff!12'},authenticated=False,ip='203.0.113.99')
        self.assertEqual(code,200,data)
        self.cookie=r['headers']['Set-Cookie'].split(';')[0];self.csrf=data['csrf']
        return data

    def fake(self,deny=False):
        calls=[]
        def transport(token,query,variables):
            calls.append((query,variables))
            self.assertTrue(query.startswith('query '))
            if deny: raise RemoteError('permission_denied')
            if 'currentClub' in query:return {'currentClub':{'id':42,'name':'Test club','city':'Test','timezone':5}}
            if 'featureFlags' in query:return {'featureFlags':{'subscription':'TEST','expires_at':'2027-01-01','modules':['booking'],'host_count':2}}
            if 'hostsOverview' in query:return {'hostsOverview':[{'id':1,'alias':'One','group_id':3,'online':True,'in_service':False,'online_booking_enabled':True},{'id':2,'alias':'Two','group_id':3,'online':False,'in_service':False,'online_booking_enabled':True}]}
            client={'id':4,'uuid':'remote-client','nickname':'test','phone':'+70000000001'}
            if 'user(' in query:return {'user':client}
            if 'clients(' in query or 'searchClients(' in query:return {'clients':{'data':[client],'paginatorInfo':{'total':1,'hasMorePages':False}}}
            if 'getBookings(' in query:return {'getBookings':{'data':[],'paginatorInfo':{'total':0,'hasMorePages':False}}}
            raise AssertionError(query)
        self.app.smartshell.transport=transport
        return calls

    def connect(self,deny=False):
        calls=self.fake(deny)
        code,data,_=self.call('/api/admin/smartshell','POST',{'token':'fake-test-token-not-a-real-secret','version':0})
        self.assertEqual(code,200,data)
        return data,calls

    def test_owner_cannot_be_delegated_or_overwritten(self):
        self.owner();role=self.role(['bookings.read'])
        for name in ['admin333','test-admin']:
            self.assertEqual(self.call('/api/admin/access','POST',{'kind':'staff','name':'X','username':name,'password':'TestStaff!12','roleId':role})[0],400)
        self.assertEqual(self.call('/api/admin/access','POST',{'kind':'role','name':'X','permissions':['owner']})[0],400)
        self.assertEqual(self.call('/api/admin/access','POST',{'kind':'role','name':'X','permissions':['smartshell.payments']})[0],400)
        self.assertTrue(self.call('/api/admin/session')[1]['user']['isOwner'])

    def test_staff_server_permissions_and_no_secrets(self):
        self.owner();role=self.role(['bookings.read']);self.staff(role);session=self.staff_login()
        self.assertFalse(session['user']['isOwner'])
        for route in ['access','settings','health','profiles','guests','game','audit','events','overview','smartshell','smartshell/equipment']:
            self.assertEqual(self.call('/api/admin/'+route)[0],403,route)
        for route,method in [('access','POST'),('smartshell','POST'),('smartshell/mapping','PATCH'),('game-settings','PATCH'),('bookings','POST')]:
            self.assertEqual(self.call('/api/admin/'+route,method,{})[0],403,(route,method))
        self.assertEqual(self.call('/api/admin/bookings')[0],200)
        self.assertNotIn('password',json.dumps(session).lower())

    def test_role_revocation_applies_to_existing_sessions(self):
        self.owner();role=self.role(['bookings.write']);self.staff(role);self.staff_login();staff=(self.cookie,self.csrf)
        self.assertEqual(self.create_booking()[0],201)
        self.as_owner();self.assertEqual(self.call('/api/admin/access','PATCH',{'kind':'role','id':role,'version':1,'name':'Чтение','permissions':[]})[0],200)
        self.cookie,self.csrf=staff
        self.assertEqual(self.call('/api/admin/bookings')[0],403)
        self.assertEqual(self.create_booking()[0],403)

    def test_disable_revokes_session_and_audit_has_staff_actor(self):
        self.owner();role=self.role(['bookings.write']);sid=self.staff(role);self.staff_login();staff=(self.cookie,self.csrf)
        code,booking,_=self.create_booking();self.assertEqual(code,201,booking)
        audit=self.app.atomic(lambda tx:tx.scan('audit'),self.now)
        self.assertTrue(any(a['actor']=='shift_admin' and a['entityId']==booking['id'] for a in audit))
        self.as_owner();self.assertEqual(self.call('/api/admin/access','PATCH',{'kind':'staff','id':sid,'version':1,'name':'Тест','roleId':role,'disabled':True})[0],200)
        self.cookie,self.csrf=staff;self.assertEqual(self.call('/api/admin/bookings')[0],401)

    def test_exports_require_both_permissions(self):
        self.owner();role=self.role(['bookings.read','data.export']);self.staff(role);self.staff_login()
        self.assertEqual(self.call('/api/admin/export',query={'dataset':'bookings'})[0],200)
        for resource in ['guests','events','audit']:
            self.assertEqual(self.call('/api/admin/export',query={'dataset':resource})[0],403)

    def test_restricted_token_not_misreported_as_plan(self):
        self.owner();data,calls=self.connect(True)
        self.assertEqual(data['state'],'restricted');self.assertIsNone(data['subscription'])
        self.assertEqual(len(calls),1);self.assertEqual(data['capabilities']['clients'],'unknown')
        self.assertEqual(self.call('/api/admin/smartshell/equipment')[0],409)

    def test_token_encrypted_and_never_returned_or_audited(self):
        self.owner();data,calls=self.connect()
        self.assertEqual(len(calls),5);self.assertTrue(data['readOnly'])
        for value in [data,self.call('/api/admin/smartshell')[1],self.call('/api/admin/access')[1],self.store.records]:
            self.assertNotIn('fake-test-token-not-a-real-secret',str(value))
        config=self.app.smartshell.config(self.now)
        self.assertEqual(self.app.smartshell.token(config),'fake-test-token-not-a-real-secret')
        config['_token']=config['_token'][:-4]+'AAAA'
        with self.assertRaises(base.ApiError if hasattr(base,'ApiError') else Exception):self.app.smartshell.token(config)

    def test_capability_and_staff_permission_intersection(self):
        self.owner();self.connect();role=self.role(['smartshell.equipment']);self.staff(role);self.staff_login()
        status=self.call('/api/admin/smartshell')[1]
        self.assertEqual(list(status['capabilities']),['equipment'])
        self.assertNotIn('subscription',status);self.assertNotIn('mapping',status)
        self.assertEqual(self.call('/api/admin/smartshell/equipment')[0],200)
        self.assertEqual(self.call('/api/admin/smartshell/clients',query={'q':'test'})[0],403)
        self.assertEqual(self.call('/api/admin/smartshell/check','POST',{'version':1})[0],403)

    def test_mapping_validates_remote_hosts_and_conflicts(self):
        self.owner();self.connect()
        route='/api/admin/smartshell/mapping'
        for mapping in [{'standard':[1],'pro':[1],'vip':[]},{'standard':[99],'pro':[],'vip':[]}]:
            self.assertEqual(self.call(route,'PATCH',{'version':1,'mapping':mapping})[0],400)
        self.assertEqual(self.call(route,'PATCH',{'version':1,'mapping':{'standard':[1],'pro':[2],'vip':[]}})[0],200)
        self.assertEqual(self.call(route,'PATCH',{'version':1,'mapping':{'standard':[],'pro':[],'vip':[]}})[0],409)

    def test_manual_link_is_unique_and_cannot_change_club(self):
        self.owner();self.connect()
        guests=[self.call('/api/admin/guests','POST',{'name':'Test '+str(i)})[1] for i in range(2)]
        body={'guestId':guests[0]['id'],'uuid':'remote-client','version':0,'confirmed':True}
        self.assertEqual(self.call('/api/admin/smartshell/link','POST',dict(body,confirmed=False))[0],400)
        self.assertEqual(self.call('/api/admin/smartshell/link','POST',body)[0],200)
        self.assertEqual(self.call('/api/admin/smartshell/link','POST',dict(body,guestId=guests[1]['id']))[0],409)
        self.assertEqual(self.call('/api/admin/guests/'+guests[0]['id'],'DELETE',{'version':1})[0],409)
        self.app.smartshell.transport=lambda *args:{'currentClub':{'id':77}}
        self.assertEqual(self.call('/api/admin/smartshell','POST',{'token':'other-fake-token-1234567890','version':1})[0],409)
        self.assertEqual(self.app.smartshell.config(self.now)['clubId'],'42')

    def test_local_booking_and_registration_never_write_remote(self):
        self.owner();_,calls=self.connect();before=len(calls)
        code,b,_=self.create_booking();self.assertEqual(code,201)
        self.assertEqual(self.call('/api/admin/bookings/'+b['id'],'PATCH',{'version':1,'status':'confirmed'})[0],200)
        intent=self.app.atomic(lambda tx:tx.get('ss_booking_intents',b['id']),self.now)
        self.assertEqual(intent['status'],'confirmed');self.assertEqual(intent['state'],'read_only')
        code,p,_=self.call('/api/member/register','POST',{'username':'new_driver','name':'Test','password':'TestPilot!12','consent':True},authenticated=False)
        self.assertEqual(code,201,p)
        intents=self.app.atomic(lambda tx:tx.scan('ss_profile_intents'),self.now)
        self.assertEqual(len(intents),1);self.assertEqual(intents[0]['state'],'read_only')
        self.assertEqual(len(calls),before)

    def test_no_arbitrary_proxy_or_mutation(self):
        self.owner();self.connect()
        for method in ['POST','PATCH','DELETE']:
            self.assertEqual(self.call('/api/admin/smartshell/query',method,{'query':'mutation Bad {createPayment{ id }}'})[0],404)
        with self.assertRaises(RemoteError): self.app.smartshell.http('fake','mutation Bad {}',{})
        self.assertEqual(self.call('/api/admin/smartshell','POST',{'version':1,'token':'fake-test-token-not-a-real-secret','endpoint':'http://localhost'})[0],400)

    def account(self):
        self.owner();calls=self.fake();auth=[]
        def transport(query,variables):
            auth.append((query,variables))
            self.assertIn(query,(AUTH_LOGIN,AUTH_REFRESH))
            key='login' if query==AUTH_LOGIN else 'refreshToken'
            return {key:{'access_token':'fake-access-token-'+str(len(auth)).zfill(8),
                         'refresh_token':'fake-refresh-token-'+str(len(auth)).zfill(8),
                         'expires_in':86400,'token_type':'Bearer'}}
        self.app.smartshell.auth_transport=transport
        body={'login':'test-owner','password':'Private-Test-Password!','clubId':42,'version':0}
        code,data,_=self.call('/api/admin/smartshell/login','POST',body)
        self.assertEqual(code,200,data)
        return data,auth,calls

    def test_account_login_encrypts_tokens_without_saving_password(self):
        data,auth,calls=self.account()
        self.assertEqual(data['authMode'],'account');self.assertEqual(len(auth),1)
        self.assertEqual(auth[0][1]['input']['company_id'],42)
        self.assertEqual(len(calls),5)
        stored=str(self.store.records)+str(data)
        for secret in ['Private-Test-Password!','fake-access-token-','fake-refresh-token-']:
            self.assertNotIn(secret,stored)
        self.assertTrue(data['readOnly'])

    def test_login_permissions_wrong_club_and_failed_login_keep_connection(self):
        data,auth,calls=self.account();original=self.app.smartshell.config(self.now)
        body={'login':'test-owner','password':'Private-Test-Password!','clubId':99,'version':1}
        self.assertEqual(self.call('/api/admin/smartshell/login','POST',body)[0],409)
        self.assertEqual(len(auth),1)
        def denied(*args):raise RemoteError('permission_denied')
        self.app.smartshell.auth_transport=denied
        body['clubId']=42
        self.assertEqual(self.call('/api/admin/smartshell/login','POST',body)[0],502)
        self.assertEqual(self.app.smartshell.config(self.now),original)
        role=self.role(['smartshell.clients']);self.staff(role);self.staff_login()
        self.assertEqual(self.call('/api/admin/smartshell/login','POST',body)[0],403)

    def expire(self):
        def save(tx):
            row=tx.get('ss_config','main');row['expiresAt']=self.now-1
            tx.put('ss_config','main',row,9999999999)
        self.app.atomic(save,self.now)

    def test_refresh_rotates_once_and_does_not_reuse_stale_credentials(self):
        _,auth,_=self.account();self.expire();stale=self.app.smartshell.config(self.now)
        self.assertEqual(self.call('/api/admin/smartshell/equipment')[0],200)
        self.assertEqual(len(auth),2);self.assertEqual(auth[-1][0],AUTH_REFRESH)
        self.assertNotIn('password',auth[-1][1]['input'])
        current=self.app.smartshell.config(self.now)
        self.assertGreater(current['expiresAt'],self.now)
        self.app.smartshell.renew(stale,self.now)
        self.assertEqual(len(auth),2)
        self.assertEqual(stale['credentialRevision'],current['credentialRevision'])

    def test_uncertain_refresh_requires_login_instead_of_replaying(self):
        self.account();self.expire();calls=[]
        def uncertain(*args):calls.append(1);raise RemoteError('unavailable')
        self.app.smartshell.auth_transport=uncertain
        for _ in range(2):
            code,data,_=self.call('/api/admin/smartshell/equipment')
            self.assertEqual(code,502,data);self.assertEqual(data['error']['code'],'smartshell_reauth_required')
        self.assertEqual(len(calls),1)
        self.assertTrue(self.call('/api/admin/smartshell')[1]['reauthRequired'])
        with self.assertRaises(RemoteError):self.app.smartshell.auth_http('mutation Arbitrary {}',{})


if __name__=='__main__':unittest.main(verbosity=2)
