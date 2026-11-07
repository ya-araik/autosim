"""Offline leader campaign tests; no cloud calls, production scores or redemptions."""
import importlib.util
import json
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
spec=importlib.util.spec_from_file_location('game_test',Path(__file__).with_name('test-game.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
from app import DAY
from game import SEASON
from rewards import club_week

class RewardTest(base.GameTest):
    # Inherited game tests also run under the same reward-aware backend.
    def setUp(self):
        super().setUp()
        code,data,r=self.call('/api/admin/login','POST',{'username':'test-admin','password':'Test admin password'})
        self.assertEqual(code,200,data)
        self.admin=dict(data,cookie=r['headers']['Set-Cookie'].split(';')[0])

    def race(self,seconds=120):
        token=self.start();self.assertEqual(self.finish(token,seconds)[0],200)
        code,data,_=self.save(token);self.assertEqual(code,200,data);return token

    def user(self,identity=None):
        return self.app.atomic(lambda tx:tx.get('members',(identity or self.identity)['user']['id']),self.now)

    def status(self):
        code,data,_=self.call('/api/game/me');self.assertEqual(code,200,data);return data['reward']

    def redeem(self,status=None,identity=None,guest=None):
        status=status or self.status()
        return self.call('/api/admin/game-reward','POST',{'guestId':guest or self.user()['guestId'],'week':status['week'],'epoch':status['epoch']},identity=identity or self.admin)

    def admin_status(self,guest):
        r=self.app.handle({'httpMethod':'GET','path':'/api/admin/game-reward','queryStringParameters':{'guestId':guest},'headers':{'Origin':base.base.ORIGIN,'Cookie':self.admin['cookie']}})
        return r['statusCode'],json.loads(r['body'])

    def test_loss_retake_and_self_improvement(self):
        first=self.register();self.race(140);initial=self.status()
        self.assertTrue(initial['available']);self.assertEqual(self.redeem()[0],200)
        self.assertEqual(self.status()['state'],'used')
        self.race(130);self.assertEqual(self.status()['epoch'],initial['epoch'])
        self.assertFalse(self.status()['available'],'An uninterrupted leader cannot farm hours')
        second=self.register('pilot_two');self.race(120)
        self.assertTrue(self.status()['available'])
        self.identity=first;self.assertEqual(self.status()['state'],'not_leader')
        self.assertEqual(self.redeem(initial)[0],409,'An open stale admin card cannot redeem after being beaten')
        self.race(110);retaken=self.status()
        self.assertNotEqual(retaken['epoch'],initial['epoch']);self.assertTrue(retaken['available'])
        self.assertEqual(retaken['week'],initial['week']);self.assertEqual(self.redeem()[0],200)
        self.assertEqual(len(self.app.atomic(lambda tx:tx.scan('game_rewards'),self.now)),2)
        self.identity=second;self.assertEqual(self.status()['state'],'not_leader')

    def test_unclaimed_hour_is_lost_and_not_accumulated(self):
        first=self.register();self.race(140);old=self.status()
        self.register('pilot_two');self.race(130)
        self.identity=first;self.assertEqual(self.status()['minutes'],0)
        self.race(120);self.assertEqual(self.status()['minutes'],60)
        self.assertEqual(self.redeem(old)[0],409)
        self.assertEqual(self.redeem()[0],200);self.assertEqual(self.status()['minutes'],0)

    def test_save_feedback_uses_current_rank_and_unspent_reward(self):
        first=self.register();token=self.race(140)
        saved=self.save(token)[1]
        self.assertEqual(saved['rank'],1);self.assertTrue(saved['reward']['available'])
        self.redeem();self.race(130)
        used=self.save(token)[1]
        self.assertEqual(used['rank'],1);self.assertEqual(used['reward']['state'],'used')
        self.register('pilot_two');self.race(120)
        self.identity=first
        retry=self.save(token)[1]
        self.assertEqual(retry['rank'],2);self.assertFalse(retry['reward']['available'])
        self.assertEqual(len(self.call('/api/game/me')[1]['history']),2,'Retry does not duplicate history')
        self.race(110)
        retaken=self.save(token)[1]
        self.assertEqual(retaken['rank'],1);self.assertTrue(retaken['reward']['available'])

    def test_training_save_does_not_claim_rank_or_reward(self):
        self.register();token=self.start()
        # Preserve a pre-v16 training receipt without allowing new novice starts.
        def legacy(tx):
            key=self.app.game.key(token);row=tx.get('game_runs',key);row['board']='novice';tx.put('game_runs',key,row,row['expires'])
        self.app.atomic(legacy,self.now);self.finish(token)
        result=self.save(token,False)[1]
        self.assertIsNone(result['rank']);self.assertIsNone(result['reward'])

    def test_monday_orenburg_boundary_and_stale_week(self):
        self.register();self.race()
        self.now=int(datetime(2026,9,20,18,59,59,tzinfo=timezone.utc).timestamp())
        code,data,r=self.call('/api/admin/login','POST',{'username':'test-admin','password':'Test admin password'})
        self.assertEqual(code,200,data);self.admin=dict(data,cookie=r['headers']['Set-Cookie'].split(';')[0])
        before=self.status();self.assertEqual(before['week'],'2026-09-14')
        self.assertEqual(before['resetsAt'],'2026-09-20T19:00:00Z');self.assertEqual(self.redeem()[0],200)
        self.now+=1;after=self.status()
        self.assertEqual(after['week'],'2026-09-21');self.assertEqual(after['epoch'],before['epoch'])
        self.assertTrue(after['available']);self.assertEqual(self.redeem(before)[0],409)
        self.assertEqual(self.redeem()[0],200);self.assertEqual(self.status()['state'],'used')
        self.now+=21*DAY
        user=self.user();late=self.app.atomic(lambda tx:self.app.game.rewards.status(tx,user,self.now),self.now)
        self.assertEqual(late['minutes'],60,'Missed weeks do not accumulate')

    def test_calendar_year_boundary(self):
        sunday=datetime(2027,1,3,18,59,59,tzinfo=timezone.utc).timestamp()
        self.assertEqual(club_week(sunday)[0],'2026-12-28')
        self.assertEqual(club_week(sunday+1)[0],'2027-01-04')

    def test_simultaneous_redemption_idempotency_and_report(self):
        self.register();self.race();state=self.status();guest=self.user()['guestId']
        with ThreadPoolExecutor(max_workers=4) as pool:
            rows=list(pool.map(lambda _:self.redeem(state,guest=guest),range(4)))
        self.assertTrue(all(row[0]==200 for row in rows),rows)
        self.assertEqual(len(self.app.atomic(lambda tx:tx.scan('game_rewards'),self.now)),1)
        audits=self.app.atomic(lambda tx:tx.scan('audit'),self.now)
        self.assertEqual(sum(r.get('action')=='game.reward.redeem' for r in audits),1)
        code,report,_=self.call('/api/admin/game',identity=self.admin)
        self.assertEqual(code,200,report);self.assertEqual(report['redeemedHours'],1)
        self.assertEqual(report['redemptions'][0]['guestId'],guest)
        code,status=self.admin_status(guest);self.assertEqual(code,200,status)
        self.assertEqual(status['reward']['state'],'used');self.assertEqual(len(status['history']),1)

    def test_permissions_nonleader_csrf_inactive_and_missing_guest(self):
        first=self.register();self.race();state=self.status()
        self.assertEqual(self.redeem(identity=first)[0],401)
        payload={'guestId':self.user()['guestId'],'week':state['week'],'epoch':state['epoch']}
        self.assertEqual(self.call('/api/admin/game-reward','POST',payload,identity=self.admin,headers={'X-CSRF-Token':'bad'})[0],403)
        self.assertEqual(self.redeem(guest=str(uuid.uuid4()))[0],404)
        guest=self.user()['guestId']
        def deactivate(tx):
            row=tx.get('guests',guest);row['status']='archived';tx.put('guests',guest,row,self.now+365*DAY)
        self.app.atomic(deactivate,self.now);self.assertEqual(self.redeem()[0],409)
        self.register('pilot_two');self.assertFalse(self.status()['available']);self.assertEqual(self.redeem()[0],409)

    def test_moderation_and_ties(self):
        first=self.register();self.race(120);state=self.status();self.redeem()
        key=SEASON+':pro:'+first['user']['id']
        self.register('pilot_two');self.race(120)
        self.assertEqual(self.leaders()[0]['username'],'pilot_one','Earlier equal record keeps P1')
        self.assertFalse(self.status()['available'])
        self.assertEqual(self.call('/api/admin/game','PATCH',{'key':key,'hidden':True},identity=self.admin)[0],200)
        self.assertTrue(self.status()['available'])
        self.identity=first;self.assertFalse(self.status()['available'])
        self.assertEqual(self.call('/api/admin/game','PATCH',{'key':key,'hidden':False},identity=self.admin)[0],200)
        self.assertTrue(self.status()['available']);self.assertNotEqual(self.status()['epoch'],state['epoch'])
        self.assertNotIn('guestId',self.leaders()[0]);self.assertNotIn('userId',self.leaders()[0])

    def test_old_season_receipts_rejected_history_retained(self):
        self.register();token=self.start();self.finish(token)
        key=self.app.game.key(token);user=self.user()
        def old(tx):
            row=tx.get('game_runs',key);row['season']='e60-sector-1';tx.put('game_runs',key,row,self.now+DAY)
            tx.put('game_history:'+user['id'],'legacy',{'id':'legacy','username':user['username'],'board':'pro','timeMs':100000,'createdAt':'2026-09-19T00:00:00Z'},self.now+365*DAY)
        self.app.atomic(old,self.now)
        self.assertEqual(self.save(token)[0],409);self.assertEqual(self.finish(token)[0],409)
        self.assertEqual(self.call('/api/game/start','POST',{'board':'pro','season':'e60-sector-1'})[0],409)
        code,data,_=self.call('/api/game/me');self.assertEqual(code,200)
        self.assertEqual(len(data['history']),1);self.assertEqual(data['reward']['state'],'not_leader')

if __name__=='__main__':unittest.main()
