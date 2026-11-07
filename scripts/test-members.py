"""Real domain/security tests against the transactional store; no external messages."""
import concurrent.futures
import json
import sys
import unittest
import uuid
from pathlib import Path
from datetime import datetime, timezone
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from app import Application, Config, make_password_hash
from storage import MemoryStore

ORIGIN = 'https://test.autosim.example'
SECRET = 'test-booking-channel-secret-32-characters'
PASSWORD = 'Test only password phrase 123!'
HASH = make_password_hash('Test admin password', 200000)


class MembersTest(unittest.TestCase):
    def setUp(self):
        self.now = int(datetime(2026, 9, 19, 7, tzinfo=timezone.utc).timestamp())
        self.store = MemoryStore()
        self.config = Config('test-admin', HASH, 'test-only-session-secret-32-characters', (ORIGIN,),
                             booking_secret=SECRET, booking_owner_id='123456789')
        self.app = Application(self.config, self.store, lambda: self.now)
        self.identity = None

    def call(self, path, method='GET', data=None, identity=None, headers=None, ip='203.0.113.5'):
        identity = identity if identity is not None else self.identity
        h = {'Content-Type': 'application/json', 'Origin': ORIGIN}
        if identity:
            h.update(Cookie=identity['cookie'], **{'X-CSRF-Token': identity['csrf']})
        h.update(headers or {})
        r = self.app.handle({'httpMethod': method, 'path': path, 'headers': h,
                             'requestContext': {'identity': {'sourceIp': ip}}, 'body': json.dumps(data or {})})
        return r['statusCode'], json.loads(r['body'] or '{}'), r

    def register(self, username='pilot_one'):
        code, data, r = self.call('/api/member/register', 'POST', {'username': username, 'password': PASSWORD,
                                          'name': 'Test Pilot', 'consent': True})
        self.assertEqual(code, 201, data)
        self.identity = dict(data, cookie=r['headers']['Set-Cookie'].split(';')[0])
        return self.identity

    def request(self, **changes):
        body = {'requestId': str(uuid.uuid4()), 'phone': '+70000000000', 'startsAt': '2026-09-20T18:00:00+05:00',
                'duration': 120, 'tariff': 'pro', 'participants': 3, 'vrCount': 2, 'consent': True, 'comment': 'Test only'}
        body.update(changes)
        return self.call('/api/member/bookings', 'POST', body)

    def bot(self, route, data=None, **kw):
        return self.call('/api/booking-bot/' + route, 'POST', data, headers={'X-Autosim-Booking-Secret': SECRET, **kw})

    def test_dashboard_queues_sync_without_waiting_for_external_service(self):
        self.register()
        self.app.atomic(lambda tx: tx.put('ss_config', 'main', {
            'clubId': '99999', 'writeMode': 'test'}, self.now + 86400), self.now)
        def forbidden(*args):
            self.fail('Reading a profile must not synchronously process SmartShell jobs')
        self.app.smartshell.sync.kick = forbidden
        self.app.smartshell.query = forbidden
        code, dashboard, _ = self.call('/api/member/me')
        self.assertEqual(code, 200)
        self.assertEqual(dashboard['user']['username'], 'pilot_one')
        self.assertTrue(any(job['state'] == 'queued' and job['kind'] == 'profile'
                            for job in dashboard['smartshell']))

    def test_registration_private_cookie_password_and_roles(self):
        code, data, _ = self.call('/api/member/me')
        self.assertEqual(code, 401)
        account = self.register()
        self.assertIn('__Host-autosim_member', account['cookie'])
        text = json.dumps(account)
        self.assertNotIn('passwordHash', text)
        self.assertEqual(self.call('/api/admin/overview')[0], 401)
        stored = json.dumps(list(self.store.records.values()))
        self.assertNotIn(PASSWORD, stored)
        self.assertNotIn(account['recoveryCode'], stored)
        self.assertNotIn(account['cookie'].split('=')[1], stored)
        self.assertEqual(self.call('/api/member/me')[1]['completedVisits'], 0)
        self.assertIsNone(self.call('/api/member/me')[1]['skill'])

    def test_no_mass_assignment_price_or_status(self):
        self.register()
        for injection in ({'status': 'confirmed'}, {'priceRub': 1}, {'_memberId': 'fake'}, {'role': 'admin'}):
            self.assertEqual(self.request(**injection)[0], 400)
        code, booking, _ = self.request()
        self.assertEqual(code, 201)
        self.assertEqual(booking['priceRub'], 6100)
        self.assertEqual(booking['status'], 'draft')
        self.assertNotIn('phone', booking)

    def test_idempotent_booking_and_owner_outbox(self):
        self.register()
        request_id = str(uuid.uuid4())
        first = self.request(requestId=request_id)[1]
        second = self.request(requestId=request_id)[1]
        self.assertEqual(first['id'], second['id'])
        self.assertEqual(len(self.call('/api/member/me')[1]['bookings']), 1)
        self.assertEqual(self.call('/api/booking-bot/lease', 'POST')[0], 403)
        code, data, _ = self.bot('lease')
        self.assertEqual(code, 200)
        job = data['job']
        self.assertEqual(job['card']['ownerId'], '123456789')
        self.assertIsNone(self.bot('lease')[1]['job'])
        self.assertEqual(self.bot('ack', {k: job[k] for k in ('id', 'version', 'leaseToken')} | {'messageId': 123})[0], 200)
        self.assertIsNone(self.bot('lease')[1]['job'])

    def test_foreign_account_cannot_read_or_cancel(self):
        first = self.register()
        booking = self.request()[1]
        self.register('pilot_two')
        self.assertEqual(self.call('/api/member/me')[1]['bookings'], [])
        self.assertEqual(self.call('/api/member/bookings/' + booking['id'] + '/cancel', 'POST', {'version': 1})[0], 404)
        self.identity = first
        self.assertEqual(self.call('/api/member/me')[1]['bookings'][0]['id'], booking['id'])

    def test_owner_identity_version_and_cancel_race(self):
        self.register()
        b = self.request()[1]
        action = {'id': b['id'], 'version': 1, 'action': 'confirm', 'actorId': '999999999'}
        self.assertEqual(self.bot('action', action)[0], 403)
        action['actorId'] = '123456789'
        self.assertEqual(self.bot('action', action)[0], 200)
        self.assertEqual(self.bot('action', action)[0], 409)
        self.assertEqual(self.call('/api/member/me')[1]['bookings'][0]['status'], 'confirmed')
        self.assertEqual(self.call('/api/member/bookings/' + b['id'] + '/cancel', 'POST', {'version': 2})[0], 200)
        action['version'] = 3
        self.assertEqual(self.bot('action', action)[0], 409)

    def test_proposal_requires_guest_acceptance_and_owner_confirmation(self):
        self.register()
        b = self.request()[1]
        data = {'id': b['id'], 'version': 1, 'actorId': '123456789'}
        self.assertEqual(self.bot('prompt', data | {'promptId': 123})[0], 200)
        self.assertFalse(self.bot('reply', {'actorId': '123456789', 'promptId': 999, 'text': '2026-09-21 18:00'})[1]['handled'])
        self.assertEqual(self.bot('reply', {'actorId': '123456789', 'promptId': 123, 'text': '2026-09-21 18:00'})[0], 200)
        latest = self.call('/api/member/me')[1]['bookings'][0]
        self.assertEqual(latest['status'], 'draft')
        self.assertTrue(latest['proposal'])
        self.assertEqual(self.bot('action', data | {'action': 'confirm', 'version': 2})[0], 409)
        self.assertEqual(self.call('/api/member/bookings/' + b['id'] + '/accept-proposal', 'POST', {'version': 2})[0], 200)
        self.assertEqual(self.bot('action', data | {'action': 'confirm', 'version': 3})[0], 200)
        latest = self.call('/api/member/me')[1]['bookings'][0]
        self.assertEqual(latest['startsAt'], '2026-09-21T13:00:00Z')
        self.assertIsNone(latest['proposal'])

    def test_confirmed_booking_can_propose_and_accept_new_hour(self):
        self.register();b=self.request()[1]
        data={'id':b['id'],'version':1,'actorId':'123456789'}
        self.assertEqual(self.bot('action',data|{'action':'confirm'})[0],200)
        self.assertEqual(self.bot('prompt',data|{'version':2,'promptId':444})[0],200)
        self.assertEqual(self.bot('reply',{'actorId':'123456789','promptId':444,'text':'2026-09-21 18:30'})[0],400)
        self.assertEqual(self.bot('reply',{'actorId':'123456789','promptId':444,'text':'2026-09-21 18:00'})[0],200)
        before=self.call('/api/member/me')[1]['bookings'][0]
        self.assertEqual(before['startsAt'],b['startsAt']);self.assertEqual(before['status'],'confirmed')
        code,moved,_=self.call('/api/member/bookings/'+b['id']+'/accept-proposal','POST',{'version':3})
        self.assertEqual(code,200);self.assertEqual(moved['status'],'confirmed')
        self.assertEqual(moved['startsAt'],'2026-09-21T13:00:00Z')
        self.assertEqual(self.bot('action',data|{'version':4,'action':'reject'})[0],200)

    def test_csrf_origins_recovery_single_use_and_session_revocation(self):
        account = self.register()
        self.assertEqual(self.call('/api/member/logout', 'POST', {}, headers={'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.call('/api/member/logout', 'POST', {}, headers={'X-CSRF-Token': 'wrong'})[0], 403)
        code, payload, _ = self.call('/api/member/recover', 'POST', {'username': 'pilot_one', 'password': 'A different long password 123!', 'recoveryCode': account['recoveryCode']})
        self.assertEqual(code, 200, payload)
        self.assertEqual(self.call('/api/member/me')[0], 401)
        self.assertEqual(self.call('/api/member/recover', 'POST', {'username': 'pilot_one', 'password': PASSWORD, 'recoveryCode': account['recoveryCode']})[0], 401)
        self.assertNotEqual(payload['recoveryCode'], account['recoveryCode'])

    def test_booking_time_and_active_limit(self):
        self.register()
        for time in ('2026-09-19T10:00:00+05:00', '2026-09-20T01:30:00+05:00', '2026-09-20T18:07:00+05:00', '2027-09-20T18:00:00+05:00'):
            self.assertEqual(self.request(startsAt=time)[0], 400)
        for _ in range(3):
            self.assertEqual(self.request()[0], 201)
        self.assertEqual(self.request()[0], 409)

    def test_concurrent_idempotency_and_stale_delivery_ack(self):
        self.register()
        request_id = str(uuid.uuid4())
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.request(requestId=request_id), range(2)))
        self.assertEqual(results[0][1]['id'], results[1][1]['id'])
        b = results[0][1]
        job = self.bot('lease')[1]['job']
        self.call('/api/member/bookings/' + b['id'] + '/cancel', 'POST', {'version': 1})
        self.assertEqual(self.bot('ack', {k: job[k] for k in ('id', 'version', 'leaseToken')} | {'messageId': 123})[0], 409)
        self.assertEqual(self.bot('lease')[1]['job']['card']['status'], 'cancelled')

    def test_unverified_notes_and_private_contacts_not_in_member_card(self):
        self.register()
        user = next(r['value'] for (bucket, _), r in self.store.records.items() if bucket == 'members')
        guest = self.store.records[('guests', user['guestId'])]['value']
        guest.update(notes='Internal staff note', skillNote='Practise smooth braking', skillVerified=False)
        self.assertNotIn('Internal staff', json.dumps(self.call('/api/member/me')[1]))
        self.assertIsNone(self.call('/api/member/me')[1]['skill'])
        guest = self.store.records[('guests', user['guestId'])]['value']
        guest.update(skillVerified=True, skillVerifiedAt='2026-09-19T07:00:00Z')
        self.assertEqual(self.call('/api/member/me')[1]['skill']['note'], 'Practise smooth braking')

    def test_password_eight_characters_and_symbol_and_legacy_login(self):
        body = {'username': 'short_pilot', 'name': 'Test', 'consent': True}
        for value in ('Abc12@3', 'Abc12345', 'Abc1234 ', 'Пароль12'):
            self.assertEqual(self.call('/api/member/register', 'POST', body | {'password': value})[0], 400)
        code, account, response = self.call('/api/member/register', 'POST', body | {'password': 'Abc123@4'})
        self.assertEqual(code, 201)
        self.identity = dict(account, cookie=response['headers']['Set-Cookie'].split(';')[0])
        self.assertEqual(self.call('/api/member/password', 'POST', {'currentPassword': 'Abc123@4', 'password': 'Abc12345'})[0], 400)
        self.assertEqual(self.call('/api/member/recover', 'POST', {'username': body['username'], 'recoveryCode': account['recoveryCode'], 'password': 'Abc12345'})[0], 400)
        # Existing accounts may predate the symbol rule; login must keep accepting them.
        stored = self.store.records[('members', account['user']['id'])]['value']
        stored['passwordHash'] = make_password_hash('Legacy password phrase 123')
        self.assertEqual(self.call('/api/member/login', 'POST', {'username': body['username'], 'password': 'Legacy password phrase 123'})[0], 200)

    def test_cancellation_notice_receipt_survives_card_retry_and_edits(self):
        self.register()
        booking = self.request()[1]
        job = self.bot('lease')[1]['job']
        self.bot('ack', {k: job[k] for k in ('id', 'version', 'leaseToken')} | {'messageId': 123})
        self.call('/api/member/bookings/' + booking['id'] + '/cancel', 'POST', {'version': 1})
        cancelled = self.bot('lease')[1]['job']
        self.assertEqual(cancelled['messageId'], 123)
        self.assertEqual(cancelled['cancellationVersion'], 2)
        self.assertIsNone(cancelled['cancellationMessageId'])
        self.assertEqual(self.bot('cancel-ack', {'id': booking['id'], 'cancellationVersion': 2, 'messageId': 456})[0], 200)
        # A retry after an edit failure must reuse the separately acknowledged notice.
        self.now += 181
        retry = self.bot('lease')[1]['job']
        self.assertEqual(retry['cancellationMessageId'], 456)
        self.bot('ack', {k: retry[k] for k in ('id', 'version', 'leaseToken')} | {'messageId': 123})
        def edit(tx):
            value = tx.get('bookings', booking['id'])
            value['version'] += 1
            tx.put('bookings', booking['id'], value, self.now + 86400)
            self.app.members.queue(tx, value, self.now)
        self.app.atomic(edit, self.now)
        changed = self.bot('lease')[1]['job']
        self.assertEqual(changed['version'], 3)
        self.assertEqual(changed['cancellationVersion'], 2)
        self.assertEqual(changed['cancellationMessageId'], 456)

    def test_cancellation_before_first_delivery_has_a_notice(self):
        self.register()
        booking = self.request()[1]
        self.call('/api/member/bookings/' + booking['id'] + '/cancel', 'POST', {'version': 1})
        job = self.bot('lease')[1]['job']
        self.assertIsNone(job['messageId'])
        self.assertEqual(job['cancellationVersion'], 2)

    def admin_identity(self):
        code, data, response = self.call('/api/admin/login', 'POST',
                                        {'username': 'test-admin', 'password': 'Test admin password'})
        self.assertEqual(code, 200)
        return dict(data, cookie=response['headers']['Set-Cookie'].split(';')[0])

    def test_delivery_diagnostics_and_resend_are_private_and_do_not_confirm(self):
        self.register()
        b = self.request()[1]
        path = '/api/admin/bookings/' + b['id'] + '/notification'
        self.assertEqual(self.call(path)[0], 401)
        admin = self.admin_identity()
        self.assertEqual(self.call(path, identity=admin)[1]['state'], 'pending')
        job = self.bot('lease')[1]['job']
        self.assertEqual(self.call(path, 'POST', {'version': 1}, identity=admin)[0], 409)
        self.bot('ack', {k: job[k] for k in ('id', 'version', 'leaseToken')} | {'messageId': 123})
        receipt = self.call(path, identity=admin)[1]
        self.assertEqual(receipt['state'], 'sent')
        self.assertTrue(receipt['recipientMatches'])
        self.assertNotIn(SECRET, json.dumps(receipt))
        self.assertEqual(self.call(path, 'POST', {'version': 2}, identity=admin)[0], 409)
        for _ in range(2):
            self.assertEqual(self.call(path, 'POST', {'version': 1}, identity=admin)[0], 200)
        fresh = self.bot('lease')[1]['job']
        self.assertIsNone(fresh['messageId'])
        self.assertEqual(fresh['card']['status'], 'draft')
        self.assertEqual(self.bot('ack', {k: job[k] for k in ('id', 'version', 'leaseToken')} | {'messageId': 123})[0], 409)
        self.bot('ack', {k: fresh[k] for k in ('id', 'version', 'leaseToken')} | {'messageId': 456})
        receipt = self.call(path, identity=admin)[1]
        self.assertEqual(receipt['messageId'], 456)
        self.assertFalse(receipt['retryPending'])
        self.assertEqual(self.call(path, 'POST', {'version': 1}, identity=admin)[0], 429)
        self.assertIn(('booking_delivery_history', b['id'] + ':123'), self.store.records)
        self.assertEqual(self.call('/api/member/me')[1]['bookings'][0]['status'], 'draft')

    def test_notification_resend_owner_only_and_csrf(self):
        self.register()
        b = self.request()[1]
        path = '/api/admin/bookings/' + b['id'] + '/notification'
        admin = self.admin_identity()
        role = self.call('/api/admin/access','POST',{'kind':'role','name':'Bookings',
                         'permissions':['bookings.read','bookings.write']},identity=admin)[1]['id']
        self.call('/api/admin/access','POST',{'kind':'staff','username':'shift_test','name':'Shift',
                  'password':'TestStaff!12','roleId':role},identity=admin)
        code,data,response = self.call('/api/admin/login','POST',{'username':'shift_test','password':'TestStaff!12'})
        self.assertEqual(code,200)
        staff = dict(data,cookie=response['headers']['Set-Cookie'].split(';')[0])
        self.assertEqual(self.call(path,identity=staff)[0],200)
        self.assertEqual(self.call(path,'POST',{'version':1},identity=staff)[0],403)
        self.assertEqual(self.call(path,'POST',{'version':1},identity=admin,headers={'X-CSRF-Token':'wrong'})[0],403)

    def test_notification_resend_preserved_when_booking_changes(self):
        self.register()
        b = self.request()[1]
        admin = self.admin_identity()
        path = '/api/admin/bookings/' + b['id'] + '/notification'
        self.call(path, 'POST', {'version': 1}, identity=admin)
        self.call('/api/member/bookings/' + b['id'] + '/cancel', 'POST', {'version': 1})
        job = self.bot('lease')[1]['job']
        self.assertEqual(job['card']['status'], 'cancelled')
        self.assertEqual(job['version'], 2)
        self.assertIsNone(job['messageId'])

    def test_second_owner_activation_backfills_without_duplicate_for_first(self):
        self.register()
        b = self.request()[1]
        first = self.bot('lease')[1]['job']
        self.bot('ack', {k: first[k] for k in ('id','version','leaseToken')} | {'messageId':101})
        owners = {'ownerIds':['123456789','234567890']}
        self.assertEqual(self.call('/api/booking-bot/owners','POST',owners)[0],403)
        self.assertEqual(self.bot('owners',owners)[1]['ownerCount'],2)
        self.assertEqual(self.bot('owners',owners)[0],200)
        second = self.bot('lease')[1]['job']
        self.assertEqual(second['id'],b['id'])
        self.assertEqual(second['ownerId'],'234567890')
        self.assertEqual(second['card']['ownerId'],'234567890')
        self.assertIsNone(second['messageId'])
        # A receipt for one owner cannot acknowledge the other's pending delivery.
        ack = {k:second[k] for k in ('id','version','leaseToken','ownerId')} | {'messageId':202}
        self.assertEqual(self.bot('ack',ack | {'ownerId':'123456789'})[0],409)
        self.assertEqual(self.bot('ack',ack)[0],200)
        self.assertIsNone(self.bot('lease')[1]['job'])
        self.assertEqual(self.bot('owners',{'ownerIds':['123456789','345678901']})[0],409)
        self.assertEqual(self.bot('owners',{'ownerIds':['234567890']})[0],403)
        self.assertEqual(self.store.records[('booking_delivery',b['id'])]['value']['messageId'],101)

    def test_two_owners_share_status_with_version_conflict_and_separate_receipts(self):
        self.register()
        self.bot('owners',{'ownerIds':['123456789','234567890']})
        b = self.request()[1]
        for message_id in (101,202):
            job = self.bot('lease')[1]['job']
            self.bot('ack',{k:job[k] for k in ('id','version','leaseToken','ownerId')} | {'messageId':message_id})
        decision={'id':b['id'],'version':1,'action':'confirm','actorId':'234567890'}
        self.assertEqual(self.bot('action',decision)[0],200)
        self.assertEqual(self.bot('action',decision | {'actorId':'123456789','action':'reject'})[0],409)
        for _ in range(2):
            job=self.bot('lease')[1]['job']
            self.assertEqual(job['card']['status'],'confirmed')
            self.bot('ack',{k:job[k] for k in ('id','version','leaseToken','ownerId')} | {'messageId':job['messageId']})
        self.assertEqual(self.bot('action',decision | {'version':2,'action':'reject'})[0],200)
        jobs=[self.bot('lease')[1]['job'],self.bot('lease')[1]['job']]
        self.assertEqual({j['ownerId'] for j in jobs},{'123456789','234567890'})
        for job in jobs:
            self.assertEqual(job['cancellationVersion'],3)
            self.assertIsNone(job['cancellationMessageId'])
            self.bot('cancel-ack',{'id':b['id'],'ownerId':job['ownerId'],'cancellationVersion':3,'messageId':303})
        self.assertEqual(len([key for key in self.store.records if key[0]=='booking_cancel_delivery']),2)

    def test_second_owner_cannot_answer_first_owner_prompt(self):
        self.register()
        self.bot('owners',{'ownerIds':['123456789','234567890']})
        b=self.request()[1]
        self.bot('prompt',{'id':b['id'],'version':1,'actorId':'123456789','promptId':55})
        reply={'actorId':'234567890','promptId':55,'text':'2026-09-21 18:00'}
        self.assertFalse(self.bot('reply',reply)[1]['handled'])
        self.bot('prompt',{'id':b['id'],'version':1,'actorId':'234567890','promptId':55})
        self.assertTrue(self.bot('reply',reply)[1]['handled'])
        self.assertEqual(self.bot('reply',reply | {'actorId':'123456789'})[0],409)


if __name__ == '__main__':
    unittest.main(verbosity=2)
