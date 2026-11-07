"""Offline race persistence / abuse / attribution tests. Never seed production."""
import importlib.util
import json
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('members_test',Path(__file__).with_name('test-members.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
from game_track import POINTS, FINISH
from game import SEASON

def trace(seconds=120):
    rows=[]
    for second in range(seconds+1):
        t=.009+(FINISH+.0001-.009)*second/seconds
        f=t*(len(POINTS)-1);i=int(f);a,b=POINTS[i],POINTS[i+1]
        rows.append([second*1000,round((a[0]+(b[0]-a[0])*(f-i))*10),round((a[1]+(b[1]-a[1])*(f-i))*10)])
    return rows

class GameTest(unittest.TestCase):
    setUp=base.MembersTest.setUp
    call=base.MembersTest.call
    register=base.MembersTest.register

    def start(self, board='pro'):
        code,data,_=self.call('/api/game/start','POST',{'board':board,'season':SEASON})
        self.assertEqual(code,201,data);return data['token']

    def finish(self,token,seconds=120,**changes):
        self.now+=seconds
        data={'token':token,'timeMs':seconds*1000,'samples':trace(seconds)};data.update(changes)
        return self.call('/api/game/finish','POST',data)

    def save(self,token,publish=True):
        return self.call('/api/game/save','POST',{'token':token,'publish':publish})

    def leaders(self):
        code,data,_=self.call('/api/game/leaders');self.assertEqual(code,200,data);return data['items']

    def test_guest_finish_registration_save_and_private_data(self):
        token=self.start();self.assertEqual(self.finish(token)[0],200)
        self.assertEqual(self.leaders(),[])
        self.assertEqual(self.save(token)[0],401)
        code,data,r=self.call('/api/member/register','POST',{'username':'race_pilot','name':'Private name','password':base.PASSWORD,'consent':True,'gameEntry':token})
        self.assertEqual(code,201,data);self.identity=dict(data,cookie=r['headers']['Set-Cookie'].split(';')[0])
        self.assertEqual(len(self.app.atomic(lambda tx:tx.scan('game_registrations'),self.now)),1)
        first=self.save(token);self.assertEqual(first[0],200,first[1])
        self.assertEqual(self.save(token)[1],first[1],'Idempotent save')
        leaders=self.leaders();self.assertEqual(len(leaders),1);self.assertEqual(leaders[0]['username'],'race_pilot')
        self.assertNotIn('Private name',json.dumps(leaders));self.assertNotIn('userId',leaders[0])
        code,me,_=self.call('/api/game/me');self.assertEqual(code,200);self.assertEqual(len(me['history']),1)
        self.assertEqual(me['best'][0]['rank'],1)

    def test_retired_novice_and_pro_personal_best(self):
        self.register()
        self.assertEqual(self.call('/api/game/start','POST',{'board':'novice','season':SEASON})[0],400)
        for seconds in (120,130,110):
            token=self.start();self.assertEqual(self.finish(token,seconds)[0],200);self.assertEqual(self.save(token)[0],200)
        self.assertEqual(self.leaders()[0]['timeMs'],110000)
        self.assertEqual(len(self.call('/api/game/me')[1]['history']),3)

    def test_ownership_csrf_and_missing_run(self):
        self.register();token=self.start();self.finish(token)
        self.assertEqual(self.call('/api/game/save','POST',{'token':token,'publish':True},headers={'X-CSRF-Token':'bad'})[0],403)
        self.identity=None;self.register('pilot_two');self.assertEqual(self.save(token)[0],403)
        self.assertEqual(self.save('a'*43)[0],410)

    def test_bad_motion_time_end_and_expiration_rejected(self):
        for alter in ('teleport','outside','finish','clock'):
            token=self.start();samples=trace()
            if alter=='teleport':samples[25][1]=samples[85][1]
            if alter=='outside':samples[42][2]+=1000
            if alter=='finish':samples=samples[:100]
            if alter!='clock':self.now+=120
            code,_,_=self.call('/api/game/finish','POST',{'token':token,'samples':samples,'timeMs':120000})
            self.assertEqual(code,422,alter)
        token=self.start();self.now+=7201;self.assertEqual(self.finish(token)[0],410)

    def test_admin_only_moderation_persists_after_improvement(self):
        self.register();token=self.start();self.finish(token);self.save(token)
        self.assertEqual(self.call('/api/admin/game')[0],401)
        key=self.app.atomic(lambda tx:tx.scan('game_scores'),self.now)[0]['key']
        code,data,r=self.call('/api/admin/login','POST',{'username':'test-admin','password':'Test admin password'})
        self.assertEqual(code,200,data);admin=dict(data,cookie=r['headers']['Set-Cookie'].split(';')[0])
        self.assertEqual(self.call('/api/admin/game','PATCH',{'key':key,'hidden':True},identity=admin)[0],200)
        self.assertEqual(self.leaders(),[])
        token=self.start();self.finish(token,110);self.save(token);self.assertEqual(self.leaders(),[])
        self.assertEqual(self.call('/api/admin/game','PATCH',{'key':key,'hidden':False},identity=admin)[0],200)
        self.assertEqual(self.leaders()[0]['timeMs'],110000)

    def test_unfinished_or_fake_source_not_counted(self):
        token=self.start()
        code,_,_=self.call('/api/member/register','POST',{'username':'new_pilot','name':'Test','password':base.PASSWORD,'consent':True,'gameEntry':token})
        self.assertEqual(code,201)
        self.assertEqual(self.app.atomic(lambda tx:tx.scan('game_registrations'),self.now),[])

if __name__=='__main__':unittest.main()
