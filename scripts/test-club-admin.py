"""Offline permissions, profile links, moderation, limits and concurrency."""
import importlib.util, json, unittest, uuid
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
spec=importlib.util.spec_from_file_location('games',Path(__file__).with_name('test-game.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
from game import SEASON


class ClubAdminTest(base.GameTest):
    def admin(self):
        code,data,r=self.call('/api/admin/login','POST',{'username':'test-admin','password':'Test admin password'})
        self.assertEqual(code,200,data)
        return dict(data,cookie=r['headers']['Set-Cookie'].split(';')[0])

    def settings(self,admin,**changes):
        old=self.call('/api/admin/game-settings',identity=admin)[1]
        return self.call('/api/admin/game-settings','PATCH',dict(changes,version=old['version']),identity=admin)

    def test_controls_permissions_validation_and_pilot_limits(self):
        self.register();pilot=self.identity;admin=self.admin()
        self.assertEqual(self.call('/api/admin/game-settings',identity=pilot)[0],401)
        self.assertEqual(self.settings(admin,startsPerHour=2,startsPerIpHour=5)[0],200)
        self.start();self.start()
        self.assertEqual(self.call('/api/game/start','POST',{'board':'pro','season':SEASON})[0],429)
        error=self.app.atomic(lambda tx:tx.scan('game_start_errors'),self.now)[0]
        self.assertEqual(error['code'],'start_limit')
        self.identity=None;self.register('second_pilot');self.start()
        self.assertEqual(self.settings(admin,startsPerIpHour=1)[0],400)
        self.assertEqual(self.settings(admin,startsPerHour=0)[0],400)
        self.assertEqual(self.call('/api/admin/game-settings','PATCH',{'version':1,'enabled':False},identity=admin)[0],409)
        self.now+=3601;self.identity=pilot;self.start()
        self.assertEqual(self.settings(admin,enabled=False)[0],200)
        self.assertEqual(self.call('/api/game/start','POST',{'board':'pro','season':SEASON})[0],503)

    def test_manual_booking_profile_search_and_history_link(self):
        self.register('apex_test');pilot=self.identity;admin=self.admin()
        users=self.call('/api/admin/profiles',identity=admin)[1]['items'];self.assertEqual(len(users),1)
        gid=users[0]['guestId'];user_id=users[0]['userId']
        g=self.call('/api/admin/guests/'+gid,identity=admin)[1]
        self.assertEqual(self.call('/api/admin/guests/'+gid,'PATCH',{'version':g['version'],'phone':'+7 (951) 123-45-67','name':'Updated Name'},identity=admin)[0],200)
        from app import Request
        for query in ['apex_test','@apex_test','Updated Name','9511234567',user_id]:
            request=Request({'httpMethod':'GET','queryStringParameters':{'q':query}})
            self.assertEqual(self.app.club_admin.profiles(request,self.now)['total'],1,query)
        body={'guestId':gid,'guestName':'Updated Name','phone':'+79511234567','startsAt':'2026-09-20T18:00:00+05:00','duration':60,'tariff':'standard','participants':1,'vrCount':0,'status':'draft'}
        code,booking,_=self.call('/api/admin/bookings','POST',body,identity=admin);self.assertEqual(code,201,booking)
        me=self.call('/api/member/me',identity=pilot)[1];self.assertEqual(me['bookings'][0]['id'],booking['id']);self.assertEqual(me['user']['name'],'Updated Name')
        self.assertEqual(self.call('/api/admin/bookings/'+booking['id'],'PATCH',{'version':booking['version'],'guestId':None},identity=admin)[0],409)
        detail=self.call('/api/admin/profiles/'+gid,identity=admin)[1]
        self.assertEqual(detail['user']['username'],'apex_test');self.assertEqual(len(detail['bookings']),1)
        raw=json.dumps(detail);self.assertNotIn('passwordHash',raw);self.assertNotIn('recovery',raw);self.assertNotIn('authVersion',raw)
        self.assertEqual(self.call('/api/admin/profiles/'+gid,identity=pilot)[0],401)
        self.assertEqual(self.call('/api/admin/guests/'+gid,'DELETE',{'version':g['version']+1},identity=admin)[0],409)

    def test_rejected_finish_review_approval_and_duplicate_safety(self):
        self.register();pilot=self.identity;admin=self.admin();token=self.start()
        bad=base.trace();bad[42][1]+=2000
        self.assertEqual(self.finish(token,samples=bad)[0],422)
        attempts=self.app.atomic(lambda tx:tx.scan('game_attempts'),self.now);self.assertEqual(attempts[0]['status'],'rejected')
        body={'requestId':str(uuid.uuid4()),'token':token,'timeMs':120000,'season':SEASON,'samples':bad,'comment':'Please check'}
        code,review,_=self.call('/api/game/review','POST',body);self.assertEqual(code,200,review)
        self.assertEqual(self.call('/api/game/review','POST',body)[1]['id'],review['id'])
        self.assertEqual(self.leaders(),[])
        decision={'id':review['id'],'version':1,'decision':'approved','note':'Club owner confirmed evidence'}
        self.assertEqual(self.call('/api/admin/game-reviews','PATCH',decision,identity=pilot)[0],401)
        with ThreadPoolExecutor(2) as pool:
            results=list(pool.map(lambda _:self.call('/api/admin/game-reviews','PATCH',decision,identity=admin),range(2)))
        self.assertEqual([r[0] for r in results],[200,200]);self.assertEqual(self.leaders()[0]['timeMs'],120000)
        me=self.call('/api/game/me')[1];self.assertEqual(len(me['history']),1);self.assertEqual(me['reviews'][0]['status'],'approved');self.assertTrue(me['reward']['available'])
        self.assertEqual(self.call('/api/admin/game-reviews','PATCH',dict(decision,decision='rejected'),identity=admin)[0],409)
        self.assertEqual(self.save(token)[0],200);self.assertEqual(len(self.call('/api/game/me')[1]['history']),1)

    def test_foreign_review_denied_and_manual_entry_requires_separate_decision(self):
        self.register();token=self.start();self.identity=None;self.register('second_pilot')
        data={'requestId':str(uuid.uuid4()),'token':token,'timeMs':120000,'season':SEASON}
        self.assertEqual(self.call('/api/game/review','POST',data)[0],403)
        admin=self.admin();gid=next(r['guestId'] for r in self.call('/api/admin/profiles',identity=admin)[1]['items'] if r['username']=='second_pilot')
        entry={'guestId':gid,'timeMs':91200,'reason':'Confirmed by club owner','requestId':str(uuid.uuid4())}
        code,r,_=self.call('/api/admin/game-reviews','POST',entry,identity=admin);self.assertEqual(code,200,r);self.assertEqual(self.leaders(),[])
        self.assertEqual(self.call('/api/admin/game-reviews','PATCH',{'id':r['id'],'version':1,'decision':'approved','note':''},identity=admin)[0],400)
        self.assertEqual(self.call('/api/admin/game-reviews','PATCH',{'id':r['id'],'version':1,'decision':'rejected','note':'Insufficient evidence'},identity=admin)[0],200)
        self.assertEqual(self.leaders(),[])

    def test_maintenance_does_not_discard_already_started_run(self):
        self.register();admin=self.admin();token=self.start()
        self.settings(admin,enabled=False)
        self.assertEqual(self.finish(token)[0],200);self.assertEqual(self.save(token)[0],200)

    def test_profile_rank_matches_public_ranking_when_faster_pilot_is_hidden(self):
        self.register('fast_pilot');admin=self.admin()
        token=self.start();self.finish(token);self.save(token)
        self.identity=None;self.register('next_pilot')
        token=self.start();self.assertEqual(self.finish(token,125)[0],200);self.assertEqual(self.save(token)[0],200)
        scores=self.app.atomic(lambda tx:self.app.game.leaders(tx,'pro',True,True),self.now)
        fast=next(r for r in scores if r['username']=='fast_pilot')
        other=next(r for r in scores if r['username']=='next_pilot')
        self.app.atomic(lambda tx:tx.put('game_hidden',fast['key'],{'hidden':True},self.now+86400),self.now)
        profile=self.call('/api/admin/profiles/'+other['guestId'],identity=admin)[1]
        self.assertEqual(profile['best']['rank'],1)
        profile=self.call('/api/admin/profiles/'+fast['guestId'],identity=admin)[1]
        self.assertIsNone(profile['best']['rank']);self.assertTrue(profile['best']['hidden'])

if __name__=='__main__':unittest.main()
