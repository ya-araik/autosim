"""Seat allocation regression tests. Fake transport, real transactional store."""
import sys,unittest,uuid,concurrent.futures
from pathlib import Path
from datetime import datetime,timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from app import Application,Config,make_password_hash,ApiError,stamp,parse_instant
from storage import MemoryStore
from seat_booking import SCHEDULE

class SeatTests(unittest.TestCase):
    def setUp(self):
        self.now=int(datetime(2026,9,25,6,tzinfo=timezone.utc).timestamp())
        self.app=Application(Config('qa',make_password_hash('test-only',200000),'test-private-secret-32-characters',('https://qa.test',),booking_secret='test-booking-channel-secret-32-chars',booking_owner_id='123456789'),MemoryStore(),lambda:self.now)
        self.mapping={'standard':list(range(101,108)),'pro':[201,202],'vip':[301]}
        self.config={'clubId':'99999','writeMode':'test','mapping':self.mapping}
        self.app.atomic(lambda tx:tx.put('ss_config','main',self.config,9999999999),self.now)
        self.remote=[];self.calls=0;self.down=False;self.maintenance=[]
        def query(config,query,variables,now):
            self.calls+=1
            if self.down:raise ApiError(503,'offline','Offline')
            self.assertEqual(query,SCHEDULE)
            return {'hostsOverview':[{'id':h,'in_service':h in self.maintenance,'online_booking_enabled':True} for a in self.mapping.values() for h in a],
                    'getBookings':{'data':self.remote,'paginatorInfo':{'hasMorePages':False}}}
        self.app.smartshell.query=query
    def booking(self,seat='P01',start='2026-09-26T00:00:00+05:00',duration=60):
        tariff={'S':'standard','P':'pro','V':'vip'}[seat[0]]
        v=self.app.validate_booking({'startsAt':start,'duration':duration,'tariff':tariff,'participants':1},self.now)
        v.update(id=str(uuid.uuid4()),version=1,guestId=None,_memberId='member-test',createdAt=stamp(self.now),updatedAt=stamp(self.now))
        return v
    def occupy(self,host=201,start='2026-09-25 23:30:00',end='2026-09-26 00:30:00'):
        self.remote.append({'id':len(self.remote)+1,'hosts':[host],'from':start,'to':end,'status':'ACTIVE'})
    def allocate(self,v,seats):
        snapshot=self.app.seats.prepare(v,seats,self.now)
        def save(tx):
            self.app.seats.assert_free(tx,v,*snapshot,self.now)
            tx.put('bookings',v['id'],v,self.now+86400*10)
        self.app.atomic(save,self.now)
        return v
    def available(self,duration=60):
        r=type('Request',(),{'query':{'date':'2026-09-26','duration':str(duration)}})()
        return self.app.seats.availability(r,self.now)
    def test_cross_day_external_overlap_and_adjacency(self):
        self.occupy()
        data=self.available();self.assertEqual(len(data['seats']),10)
        a={s['id']:s['available'] for s in data['sessions'][0]['seats']}
        self.assertFalse(a['P01']);self.assertTrue(a['P02'])
        with self.assertRaises(ApiError):self.allocate(self.booking(),['P01'])
        self.allocate(self.booking(start='2026-09-26T01:00:00+05:00'),['P01'])
    def test_two_hours_checks_both_sessions(self):
        self.occupy(start='2026-09-26 01:00:00',end='2026-09-26 02:00:00')
        with self.assertRaises(ApiError):self.allocate(self.booking(duration=120),['P01'])
        self.allocate(self.booking(duration=60),['P01'])
        self.assertNotIn('01:00',[x['time'] for x in self.available(120)['sessions']])
    def test_seat_specific_and_maintenance_and_no_private_data(self):
        self.maintenance=[301]
        with self.assertRaises(ApiError):self.allocate(self.booking('V01'),['V01'])
        v=self.allocate(self.booking(),['P02']);self.assertEqual(v['_hostIds'],[202]);self.assertEqual(v['seatLabels'],['Pro 2'])
        raw=str(self.available())
        for key in ('host','phone','client','guestId','remoteId'):self.assertNotIn("'"+key+"'",raw)
    def test_unknown_duplicate_or_wrong_count_seats_rejected(self):
        for selected in ([],['P01','P01'],['X01'],[201],['P01','P02']):
            with self.subTest(selected=selected),self.assertRaises(ApiError):self.allocate(self.booking(),selected)
    def test_cached_view_does_not_authorize_stale_submission(self):
        self.available();self.available();self.assertEqual(self.calls,1)
        self.occupy()
        with self.assertRaises(ApiError):self.allocate(self.booking(),['P01'])
        self.assertEqual(self.calls,2)
    def test_outage_fails_closed_even_with_cached_free_seat(self):
        self.available();self.down=True
        with self.assertRaises(ApiError):self.allocate(self.booking(),['P01'])
    def test_concurrent_local_requests_one_winner(self):
        v1,v2=self.booking(),self.booking()
        a=self.app.seats.prepare(v1,['P01'],self.now);b=self.app.seats.prepare(v2,['P01'],self.now)
        def save(args):
            v,snapshot=args
            def claim(tx):
                self.app.seats.assert_free(tx,v,*snapshot,self.now);tx.put('bookings',v['id'],v,self.now+86400)
            try:self.app.atomic(claim,self.now);return True
            except ApiError:return False
        with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(save,[(v1,a),(v2,b)]))
        self.assertEqual(sum(results),1)
    def test_cancel_does_not_release_remote_before_ack(self):
        v=self.allocate(self.booking(),['P01'])
        def cancel(tx):
            v['status']='cancelled';tx.put('bookings',v['id'],v,self.now+86400)
            tx.put('ss_jobs','booking:'+v['id'],{'remoteId':9,'state':'queued'},self.now+86400)
        self.app.atomic(cancel,self.now)
        with self.assertRaises(ApiError):self.allocate(self.booking(),['P01'])
        self.app.atomic(lambda tx:tx.put('ss_jobs','booking:'+v['id'],{'remoteId':9,'state':'synced'},self.now+86400),self.now)
        self.allocate(self.booking(),['P01'])
    def test_sync_conflict_notifies_both_owners_once(self):
        v=self.allocate(self.booking(),['P01'])
        key='booking:'+v['id'];job={'id':key,'bookingId':v['id'],'kind':'booking','state':'conflict','code':'selected_seat_busy'}
        def seed(tx):
            tx.put('booking_owners','secondary',{'id':'987654321'},9999999999)
            tx.put('ss_jobs',key,job,self.now+86400)
            self.app.seats.notice(tx,job,self.now)
        self.app.atomic(seed,self.now)
        jobs=self.app.atomic(lambda tx:tx.scan('booking_notifications'),self.now)
        self.assertEqual(len(jobs),2);self.assertTrue(all(j['forceNew'] for j in jobs))
        def again(tx):
            for owner in ('123456789','987654321'):
                delivery=self.app.booking_bot.delivery_key(v['id'],owner);row=tx.get('booking_notifications',delivery);row['state']='sent';tx.put('booking_notifications',delivery,row,self.now+86400)
            self.app.seats.notice(tx,tx.get('ss_jobs',key),self.now+1)
        self.app.atomic(again,self.now)
        self.assertTrue(all(j['state']=='sent' for j in self.app.atomic(lambda tx:tx.scan('booking_notifications'),self.now)))
    def test_mixed_selection_is_server_priced(self):
        v=self.booking();v.update(participants=3,vrCount=1)
        self.allocate(v,['V01','P01','P02'])
        self.assertEqual(v['tariff'],'mixed');self.assertEqual(v['priceRub'],2800)
        self.assertEqual(set(v['_hostIds']),{201,202,301})
        changed=self.app.validate_booking({'version':v['version'],'duration':120},self.now,v)
        self.assertEqual(changed['priceRub'],5300)
        self.assertEqual(len(changed['items']),3)
    def test_group_rows_do_not_block_own_confirmation(self):
        v=self.allocate(self.booking(),['P01'])
        self.remote=[{'id':41,'group':'own-group','hosts':[201],'from':'2026-09-26 00:00:00','to':'2026-09-26 01:00:00','status':'ACTIVE'},
                     {'id':42,'group':'own-group','hosts':[201],'from':'2026-09-26 00:00:00','to':'2026-09-26 01:00:00','status':'ACTIVE'}]
        self.app.atomic(lambda tx:tx.put('ss_jobs','booking:'+v['id'],{'id':'booking:'+v['id'],'kind':'booking','bookingId':v['id'],'remoteId':42,'state':'synced'},self.now+86400),self.now)
        self.app.seats.preflight(v,self.now,v['id'])
        self.remote.append(dict(self.remote[0],id=43,group='another-group'))
        with self.assertRaises(ApiError):self.app.seats.preflight(v,self.now,v['id'])
    def test_rejected_move_preserves_original_reservation_state(self):
        v=self.allocate(self.booking(),['P01']);key='booking:'+v['id']
        self.app.atomic(lambda tx:tx.put('ss_jobs',key,{'id':key,'kind':'booking','bookingId':v['id'],'state':'synced','remoteId':90},self.now+86400),self.now)
        self.occupy(start='2026-09-26 01:00:00',end='2026-09-26 02:00:00')
        changed=self.app.validate_booking({'startsAt':'2026-09-26T01:00:00+05:00'},self.now,v)
        with self.assertRaises(ApiError):self.app.seats.preflight(changed,self.now,v['id'])
        self.assertEqual(self.app.atomic(lambda tx:tx.get('ss_jobs',key),self.now)['state'],'synced')
        self.assertEqual(self.app.atomic(lambda tx:tx.get('bookings',v['id']),self.now)['startsAt'],v['startsAt'])

    def test_mixed_booking_fails_as_a_whole_if_one_seat_busy(self):
        self.occupy(host=301)
        v=self.booking();v.update(participants=3)
        with self.assertRaises(ApiError):self.allocate(v,['P01','P02','V01'])
        self.assertEqual(self.app.atomic(lambda tx:tx.scan('bookings'),self.now),[])
    def test_seat_class_cannot_be_underpriced_by_client(self):
        v=self.booking('S01');self.allocate(v,['V01'])
        self.assertEqual(v['priceRub'],800);self.assertEqual(v['tariff'],'vip')
    def test_hourly_rule(self):
        for start,duration in [('2026-09-26T00:15:00+05:00',60),('2026-09-26T00:00:00+05:00',30)]:
            with self.assertRaises(ApiError):self.allocate(self.booking(start=start,duration=duration),['P01'])

if __name__=='__main__':unittest.main(verbosity=2)
