"""Behavioural tests with a simulated remote service; no live network or club."""
import importlib.util
import json
import unittest
import uuid
from pathlib import Path
from datetime import datetime,timezone,timedelta

spec=importlib.util.spec_from_file_location('access_tests',Path(__file__).with_name('test-admin-access.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
from smartshell_sync import CREATE_CLIENT,CREATE_BOOKING,UPDATE_BOOKING,STATUS_BOOKING,VERIFY_CLIENT,SEND_CODE,FOREVER
from smartshell import RemoteError


class SyncTests(unittest.TestCase):
    call=base.IntegrationTest.call
    login=base.IntegrationTest.login
    owner=base.IntegrationTest.owner
    def setUp(self):
        base.IntegrationTest.setUp(self);self.owner();self.clients=[];self.remote_bookings={};self.sent=[];self.fail_after=False
        self.app.smartshell.transport=self.read
        self.app.smartshell.sync.transport=self.write
        config={'version':1,'clubId':'99999','writeMode':'test','_token':self.app.smartshell.seal('fake-only-token'),
                'mapping':{'standard':[11],'pro':[12],'vip':[13]},
                'status':{'state':'connected','club':{'id':99999},'capabilities':dict.fromkeys(['equipment','clients','bookings'],'available')}}
        self.app.atomic(lambda tx:tx.put('ss_config','main',config,FOREVER),self.now)

    def read(self,token,q,v):
        if 'currentClub' in q:return {'currentClub':{'id':99999}}
        if 'AutosimActiveSchedule' in q:return {'hostsOverview':[{'id':i,'in_service':False,'online_booking_enabled':True} for i in [11,12,13]],'getBookings':{'data':list(self.remote_bookings.values()),'paginatorInfo':{'hasMorePages':False}}}
        if 'hostsOverview' in q:return {'hostsOverview':[{'id':i,'in_service':False,'online_booking_enabled':True} for i in [11,12,13]]}
        if 'searchClients(' in q:return {'clients':{'data':[c for c in self.clients if c['login']==v.get('input',{}).get('q')],'paginatorInfo':{'hasMorePages':False}}}
        if 'getBookings(' in q:return {'getBookings':{'data':list(self.remote_bookings.values()),'paginatorInfo':{'hasMorePages':False}}}
        if 'getBooking(' in q:return {'getBooking':dict(self.remote_bookings[v['id']])}
        raise AssertionError(q)

    def write(self,token,q,v):
        self.sent.append(q)
        if q==CREATE_CLIENT:
            row={'id':70+len(self.clients),'uuid':str(uuid.uuid4()),'login':v['input']['login'],'nickname':v['input']['login']}
            self.clients.append(row);out={'register':row}
        elif q==CREATE_BOOKING:
            b=v['input'];i=100+len(self.remote_bookings)
            row=dict(b,id=i,client={'id':b['client']});self.remote_bookings[i]=row;out={'createBooking':row}
        elif q==UPDATE_BOOKING:
            b=v['input'];i=v['id'];row=dict(b,id=i,client={'id':b['client']});self.remote_bookings[i]=row;out={'updateBooking':row}
        elif q==STATUS_BOOKING:
            row=self.remote_bookings[v['id']];row['status']=v['status'];out={'setBookingStatus':dict(row)}
        else:raise AssertionError(q)
        if self.fail_after:raise RemoteError('unavailable')
        return out

    def tick(self):self.now+=365

    def guest(self, **profile):
        member_id,guest_id=str(uuid.uuid4()),str(uuid.uuid4())
        user={'id':member_id,'guestId':guest_id,'phone':'+70000000000','birthDate':'2000-01-01','name':'Fixture',**profile}
        def store(tx):
            tx.put('members',member_id,user,FOREVER)
            tx.put('guests',guest_id,dict(id=guest_id,_ssTestClub='99999'),FOREVER)
            self.app.smartshell.sync.queue_profile(tx,user,self.now)
        self.app.atomic(store,self.now)
        self.app.smartshell.sync.process('profile:'+guest_id,self.now)
        self.tick();return guest_id

    def booking(self,guest_id,**changes):
        start=datetime.fromtimestamp(self.now,timezone.utc).replace(hour=12,minute=0,second=0)+timedelta(days=1)
        b=dict(id=str(uuid.uuid4()),guestId=guest_id,version=1,status='confirmed',tariff='standard',participants=1,vrCount=0,
               startsAt=start.isoformat().replace('+00:00','Z'),endsAt=(start+timedelta(hours=1)).isoformat().replace('+00:00','Z'))
        b.update(changes)
        self.save_booking(b);return b

    def save_booking(self,b):
        def store(tx):
            tx.put('bookings',b['id'],b,FOREVER);self.app.smartshell.sync.queue_booking(tx,b,self.now)
        self.app.atomic(store,self.now)

    def run_booking(self,b):return self.app.smartshell.sync.process('booking:'+b['id'],self.now)

    def test_missing_profile_data_waits_without_remote_write(self):
        g=self.guest(phone='',birthDate='');self.assertEqual(len(self.clients),0)
        self.assertEqual(self.app.atomic(lambda tx:tx.get('ss_jobs','profile:'+g),self.now)['state'],'needs_profile_data')

    def test_selected_draft_holds_exact_seat_before_owner_confirmation(self):
        g=self.guest();b=self.booking(g,status='draft',_hostIds=[11],seatIds=['S01'],seatLabels=['Standard 1'])
        self.assertEqual(self.run_booking(b)['state'],'synced')
        self.assertEqual(self.remote_bookings[100]['hosts'],[11])
        self.assertEqual(self.app.atomic(lambda tx:tx.get('bookings',b['id']),self.now)['status'],'draft')
        self.tick();b.update(version=2,status='confirmed');self.save_booking(b)
        self.assertEqual(self.run_booking(b)['state'],'synced');self.assertEqual(self.sent.count(CREATE_BOOKING),1)
        self.tick();b.update(version=3,status='cancelled');self.save_booking(b);self.run_booking(b)
        self.assertEqual(self.remote_bookings[100]['status'],'CANCELED')

    def test_grouped_remote_rows_confirm_without_second_create(self):
        g=self.guest();b=self.booking(g,status='draft',_hostIds=[11,12],participants=2)
        self.run_booking(b)
        self.remote_bookings[100]['group']='same-group'
        self.remote_bookings[101]=dict(self.remote_bookings[100],id=101)
        self.tick();b.update(version=2,status='confirmed');self.save_booking(b)
        self.assertEqual(self.run_booking(b)['state'],'synced')
        self.assertEqual(self.sent.count(CREATE_BOOKING),1)
    def test_lost_group_response_recovers_as_single_booking(self):
        g=self.guest();b=self.booking(g,_hostIds=[11,12],participants=2)
        self.fail_after=True;self.run_booking(b);self.fail_after=False
        self.remote_bookings[100]['group']='same-group'
        self.remote_bookings[101]=dict(self.remote_bookings[100],id=101)
        self.tick();self.assertEqual(self.run_booking(b)['state'],'synced')
        self.assertEqual(self.sent.count(CREATE_BOOKING),1)
    def test_selected_cockpit_is_never_silently_reassigned(self):
        g=self.guest();first=self.booking(g);self.run_booking(first);self.tick()
        other=self.booking(g,status='draft',_hostIds=[11],seatIds=['S01'])
        result=self.run_booking(other)
        self.assertEqual(result['state'],'conflict');self.assertEqual(result['code'],'selected_seat_busy')
        self.assertEqual(self.sent.count(CREATE_BOOKING),1)

    def test_wrong_club_cannot_enable_writes(self):
        def swap(tx):
            c=tx.get('ss_config','main');c['clubId']='42';tx.put('ss_config','main',c,FOREVER)
        self.app.atomic(swap,self.now)
        self.assertEqual(self.call('/api/admin/smartshell/mode','PATCH',{'enabled':True,'version':1})[0],403)
        self.guest();self.assertEqual(self.sent,[])

    def test_profile_created_and_linked_once(self):
        g=self.guest();self.app.smartshell.sync.process('profile:'+g,self.now)
        self.assertEqual(len(self.clients),1)
        self.assertTrue(self.app.atomic(lambda tx:tx.get('ss_links',g),self.now))

    def test_budget_wait_is_queued_without_duplicate_dispatch(self):
        g=self.guest();b=self.booking(g)
        transport=self.app.smartshell.transport
        self.app.smartshell.transport=lambda *args:(_ for _ in ()).throw(RemoteError('rate_limited'))
        self.assertEqual(self.run_booking(b)['state'],'queued')
        self.assertEqual(self.sent.count(CREATE_BOOKING),0)
        self.app.smartshell.transport=transport
        self.assertIsNone(self.run_booking(b))
        self.tick();self.assertEqual(self.run_booking(b)['state'],'synced')
        self.assertEqual(self.sent.count(CREATE_BOOKING),1)

    def test_lost_profile_response_reconciles_without_duplicate(self):
        self.fail_after=True;g=self.guest();self.fail_after=False
        r=self.app.smartshell.sync.process('profile:'+g,self.now)
        self.assertEqual(r['state'],'synced');self.assertEqual(len(self.clients),1)

    def test_create_move_cancel_and_repeat(self):
        g=self.guest();b=self.booking(g);r=self.run_booking(b)
        self.assertEqual(r['state'],'synced');self.assertEqual(len(self.remote_bookings),1)
        self.tick();b['version']+=1
        b['startsAt']=b['startsAt'].replace('12:00','13:00');b['endsAt']=b['endsAt'].replace('13:00','14:00')
        self.save_booking(b);self.assertEqual(self.run_booking(b)['state'],'synced')
        self.tick();b.update(version=b['version']+1,status='cancelled');self.save_booking(b)
        self.assertEqual(self.run_booking(b)['state'],'synced');self.assertEqual(self.remote_bookings[100]['status'],'CANCELED')
        self.tick();self.run_booking(b);self.assertEqual(self.sent.count(CREATE_BOOKING),1)

    def test_lost_booking_response_reconciles_without_duplicate(self):
        g=self.guest();b=self.booking(g);self.fail_after=True
        self.assertEqual(self.run_booking(b)['state'],'uncertain')
        self.tick();self.fail_after=False
        self.assertEqual(self.run_booking(b)['state'],'synced');self.assertEqual(self.sent.count(CREATE_BOOKING),1)

    def test_remote_edit_blocks_overwrite(self):
        g=self.guest();b=self.booking(g);self.run_booking(b);self.tick()
        self.remote_bookings[100]['from']=self.remote_bookings[100]['from'].replace('17:00','17:30')
        b.update(version=2);self.save_booking(b)
        self.assertEqual(self.run_booking(b)['state'],'conflict');self.assertEqual(self.sent.count(UPDATE_BOOKING),0)

    def test_capacity_conflict_does_not_create(self):
        g=self.guest();b=self.booking(g);self.run_booking(b);self.tick()
        other=self.booking(g,startsAt=b['startsAt'],endsAt=b['endsAt'])
        self.assertEqual(self.run_booking(other)['state'],'conflict');self.assertEqual(self.sent.count(CREATE_BOOKING),1)

    def test_draft_waits_for_owner(self):
        g=self.guest();b=self.booking(g,status='draft');self.assertIsNone(self.run_booking(b));self.assertEqual(self.sent.count(CREATE_BOOKING),0)

    def test_cancel_before_create_needs_no_remote_change(self):
        g=self.guest();b=self.booking(g,status='cancelled')
        self.run_booking(b);self.assertEqual(self.app.atomic(lambda tx:tx.get('ss_jobs','booking:'+b['id']),self.now)['state'],'not_needed');self.assertEqual(self.sent.count(CREATE_BOOKING),0)

    def test_regular_registration_enters_integration_without_invite(self):
        body={'username':'sandbox_one','name':'Test','password':'TestAccount!123','consent':True,'phone':'+70000000000','birthDate':'2000-01-01'}
        code,data,_=self.call('/api/member/register','POST',body,authenticated=False)
        self.assertEqual(code,201,data);self.assertTrue(data['user']['integrationTest']);self.assertEqual(len(self.clients),1)
        self.assertEqual(self.call('/api/admin/smartshell/test-invite','POST',{})[0],404)

    def test_worker_processes_queue_and_detects_remote_edit(self):
        g=self.guest();b=self.booking(g)
        self.app.smartshell.sync.tick(self.now)
        self.assertEqual(len(self.remote_bookings),1)
        self.tick();self.remote_bookings[100]['status']='CANCELED'
        self.now+=300;self.app.smartshell.sync.tick(self.now)
        job=self.app.atomic(lambda tx:tx.get('ss_jobs','booking:'+b['id']),self.now)
        self.assertEqual(job['state'],'conflict')

    def test_remote_time_uses_club_timezone(self):
        from smartshell import shell_time,shell_instant
        self.assertEqual(shell_time('2026-09-26T13:00:00Z'),'2026-09-26 18:00:00')
        self.assertEqual(shell_instant('2026-09-26 18:00:00').isoformat(),'2026-09-26T18:00:00+05:00')


    def test_anonymous_booking_reserves_without_a_profile(self):
        b=self.booking(None);r=self.run_booking(b)
        self.assertEqual(r['state'],'synced');self.assertIsNone(self.remote_bookings[100]['client']['id'])

    def test_unverified_profile_does_not_create_twice(self):
        original=self.app.smartshell.sync.transport
        def partial(token,q,v):
            if q==CREATE_CLIENT:
                self.sent.append(q)
                return {'register':{'id':900,'uuid':'','login':v['input']['phone'],'nickname':''}}
            return original(token,q,v)
        self.app.smartshell.sync.transport=partial
        g=self.guest();job=self.app.atomic(lambda tx:tx.get('ss_jobs','profile:'+g),self.now)
        self.assertEqual(job['state'],'needs_verification')
        self.assertIsNone(self.app.atomic(lambda tx:tx.get('ss_links',g),self.now))
        self.app.smartshell.sync.process(job['id'],self.now)
        self.assertEqual(self.sent.count(CREATE_CLIENT),1)
        b=self.booking(g);self.assertEqual(self.run_booking(b)['state'],'synced')
        self.assertIsNone(self.remote_bookings[100]['client']['id'])

    def test_verification_uses_own_id_and_limits_attempts(self):
        from app import ApiError
        self.test_unverified_profile_does_not_create_twice()
        self.tick()
        job=self.app.atomic(lambda tx:next(j for j in tx.scan('ss_jobs') if j['kind']=='profile'),self.now)
        user=self.app.atomic(lambda tx:tx.get('members',job['memberId']),self.now)
        class Request:
            def body(self):return {'action':'verify','code':'123456'}
        seen=[]
        def verify(token,q,v):
            self.assertEqual(q,VERIFY_CLIENT);self.assertEqual(v['id'],900);seen.append(q)
            if len(seen)<5:raise RemoteError('remote_validation_code')
            return {'verifyUser':{'id':900,'uuid':'verified-client','nickname':'valid','login':user['phone']}}
        self.app.smartshell.sync.transport=verify
        for _ in range(4):
            with self.assertRaises(ApiError):self.app.smartshell.sync.verify_member(Request(),user,self.now)
        self.assertEqual(self.app.smartshell.sync.verify_member(Request(),user,self.now)['state'],'synced')
        self.assertEqual(self.app.atomic(lambda tx:tx.get('ss_links',user['guestId']),self.now)['id'],900)
        self.assertEqual(self.app.atomic(lambda tx:next(j for j in tx.scan('ss_jobs') if j['kind']=='booking'),self.now)['state'],'queued')

    def test_missing_club_registration_data_rejected(self):
        code,data,_=self.call('/api/member/register','POST',{'username':'no_phone','name':'Test','password':'TestAccount!123','consent':True},authenticated=False)
        self.assertEqual(code,400);self.assertEqual(self.sent,[])

    def test_timer_requires_private_envelope(self):
        import index,os
        from unittest.mock import patch
        ticks=[]
        class Application:
            clock=lambda _:123
            handle=lambda *_:{'statusCode':404}
            class Shell:
                class Sync:
                    tick=lambda _,now:ticks.append(now)
                sync=Sync()
            smartshell=Shell()
        with patch.object(index,'_application',Application()),patch.dict(os.environ,{'SS_TIMER_TRIGGER_ID':'known-timer'}):
            msg={'messages':[{'event_metadata':{'event_type':'yandex.cloud.events.serverless.triggers.TimerMessage','folder_id':'b1go6svrjnv2ck20p7um'},'details':{'trigger_id':'known-timer'}}]}
            self.assertEqual(index.handler(dict(msg,httpMethod='POST'),None)['statusCode'],404)
            self.assertEqual(ticks,[])
            self.assertEqual(index.handler(msg,None)['statusCode'],200);self.assertEqual(ticks,[123])
            msg['messages'][0]['details']['trigger_id']='other'
            self.assertEqual(index.handler(msg,None)['statusCode'],403);self.assertEqual(ticks,[123])


    def test_cancel_after_capacity_conflict_is_terminal(self):
        g=self.guest();a=self.booking(g);self.run_booking(a);self.tick()
        b=self.booking(g,startsAt=a['startsAt'],endsAt=a['endsAt']);self.assertEqual(self.run_booking(b)['state'],'conflict')
        b.update(status='cancelled',version=2);self.save_booking(b)
        j=self.app.atomic(lambda tx:tx.get('ss_jobs','booking:'+b['id']),self.now)
        self.assertEqual(j['state'],'not_needed');self.assertIsNone(j['code'])

    def test_cancel_after_remote_move_preserves_identity(self):
        g=self.guest();b=self.booking(g);self.run_booking(b);self.tick()
        self.remote_bookings[100]['from']=self.remote_bookings[100]['from'].replace('17:00','17:30')
        b.update(version=2);self.save_booking(b);self.assertEqual(self.run_booking(b)['state'],'conflict')
        b.update(status='cancelled',version=3);self.save_booking(b);self.tick()
        self.assertEqual(self.run_booking(b)['state'],'synced');self.assertEqual(self.remote_bookings[100]['status'],'CANCELED')


if __name__=='__main__':unittest.main()
