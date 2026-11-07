"""Offline lead intake, bot authorization, delivery and reminder regressions."""
import json
import os
from pathlib import Path
import sys
import unittest
import uuid
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from app import Application, Config, make_password_hash, ApiError
from storage import MemoryStore


class LeadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.password = make_password_hash('fixture-only-password')

    def setUp(self):
        self.now = 1800000000
        self.app = Application(Config('fixture', self.password, 'x' * 48, ('https://fixture.test',)), MemoryStore(), lambda: self.now)
        self.env = patch.dict(os.environ, {'TELEGRAM_ADMIN_CHAT_ID': '123456789'})
        self.env.start(); self.addCleanup(self.env.stop)
        self.calls = []
        self.actor = {'id': 123456789, 'first_name': 'Fixture'}

    def payload(self, **changes):
        return dict({'requestId': str(uuid.uuid4()), 'name': 'Fixture', 'phone': '+7 (900) 000-00-00',
                     'message': '<b>plain text</b>', 'source': 'Callback', 'consent': True}, **changes)

    def request(self, data, origin='https://fixture.test', method='POST', content_type='application/json'):
        headers = {'content-type': content_type}
        if origin: headers['origin'] = origin
        result = self.app.handle({'path': '/api/leads', 'httpMethod': method, 'headers': headers,
                                 'body': json.dumps(data), 'requestContext': {'identity': {'sourceIp': '203.0.113.5'}}})
        return result['statusCode'], json.loads(result['body'])

    def create(self):
        code, result = self.request(self.payload())
        self.assertEqual(code, 202, result)
        return self.get(result['id'])

    def get(self, key): return self.app.atomic(lambda tx: tx.get('leads', key), self.now)

    def telegram(self, method, payload):
        self.calls.append((method, payload))
        return {'message_id': payload.get('message_id', 100 + len(self.calls))}

    def test_public_intake_origin_validation_and_private_data(self):
        for origin in ('https://evil.test', ''): self.assertEqual(self.request(self.payload(), origin)[0], 403)
        for changes in ({'phone': 123}, {'phone': 'abc'}, {'phone': '+7 900 x 0000000'}, {'name': []}, {'consent': 'true'}, {'requestId': []}, {'message': 'x'*1201}, {'extra': 1}):
            self.assertEqual(self.request(self.payload(**changes))[0], 400, changes)
        self.assertEqual(self.request(self.payload(), content_type='text/plain')[0], 415)
        self.assertEqual(self.request({}, method='GET')[0], 404)
        lead = self.create()
        self.assertEqual(lead['phone'], '+79000000000')
        self.assertNotIn('parse_mode', self.app.leads.card(lead))

    def test_idempotency_conflict_and_rate_limit(self):
        data = self.payload()
        first = self.request(data)
        self.assertEqual(first, self.request(data))
        self.assertEqual(self.request(dict(data, name='Different'))[0], 409)
        for _ in range(4): self.assertEqual(self.request(self.payload())[0], 202)
        self.assertEqual(self.request(self.payload())[0], 429)
        self.assertEqual(self.request(data), first)

    def test_delivery_retry_and_no_duplicate_after_ack(self):
        lead = self.create()
        with self.assertRaises(RuntimeError): self.app.leads.deliver(lambda *args: (_ for _ in ()).throw(RuntimeError()), self.now)
        self.app.leads.deliver(self.telegram, self.now)
        self.assertFalse(self.calls)
        self.now += 31
        self.app.leads.deliver(self.telegram, self.now)
        self.app.leads.deliver(self.telegram, self.now)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0][0], 'sendMessage')
        self.assertTrue(self.get(lead['id'])['messageId'])

    def test_authorization_and_full_lifecycle(self):
        lead = self.create(); self.app.leads.deliver(self.telegram, self.now)
        callback = {'callback_query': {'id': 'fixture', 'from': self.actor,
                    'message': {'chat': {'id': 987654321, 'type': 'private'}, 'message_id': 101},
                    'data': f"asl:take:{lead['id']}:1"}}
        self.assertFalse(self.app.leads.update(callback, self.telegram, self.now))
        self.assertEqual(self.get(lead['id'])['status'], 'new')
        callback['callback_query']['message']['chat']['id'] = 123456789
        self.assertTrue(self.app.leads.update(callback, self.telegram, self.now))
        lead = self.get(lead['id']); self.assertEqual(lead['status'], 'in_progress')
        with self.assertRaises(ApiError): self.app.leads.action(lead['id'], 'done', {'id': 987654321}, lead['version'], self.now)
        with self.assertRaises(ApiError): self.app.leads.action(lead['id'], 'take', self.actor, 1, self.now)
        lead = self.app.leads.action(lead['id'], 'comment', self.actor, lead['version'], self.now)
        self.app.leads.deliver(self.telegram, self.now)
        self.assertEqual(self.calls[-1][0], 'editMessageText')
        reply = {'message': {'from': self.actor, 'chat': {'id': 123456789}, 'reply_to_message': {'message_id': 101}, 'text': 'Agreed'}}
        self.assertTrue(self.app.leads.update(reply, self.telegram, self.now))
        self.assertEqual(self.get(lead['id'])['completionComment'], 'Agreed')
        self.assertEqual(self.get(lead['id'])['status'], 'done')

    def test_reminders_release_and_comment_timeout(self):
        lead = self.create(); self.app.leads.deliver(self.telegram, self.now)
        self.now += 601
        self.app.leads.maintenance(self.telegram, self.now)
        count = len(self.calls)
        self.app.leads.maintenance(self.telegram, self.now)
        self.assertEqual(len(self.calls), count)
        self.assertEqual(self.get(lead['id'])['reminders'], [300, 600])
        lead = self.app.leads.action(lead['id'], 'take', self.actor, 1, self.now)
        lead = self.app.leads.action(lead['id'], 'release', self.actor, lead['version'], self.now)
        self.app.leads.maintenance(self.telegram, self.now)
        self.assertEqual(len(self.calls), count)
        lead = self.app.leads.action(lead['id'], 'take', self.actor, lead['version'], self.now)
        self.now += 3601
        self.app.leads.maintenance(self.telegram, self.now)
        self.assertEqual(self.get(lead['id'])['reminders'], [3600])
        lead = self.app.leads.action(lead['id'], 'comment', self.actor, lead['version'], self.now)
        self.now += 3601; self.app.leads.maintenance(self.telegram, self.now)
        self.assertEqual(self.get(lead['id'])['status'], 'done')

    def test_card_changes_during_delivery_are_not_lost(self):
        lead = self.create()
        def changing_send(method, payload):
            self.app.leads.action(lead['id'], 'take', self.actor, 1, self.now)
            return self.telegram(method, payload)
        self.app.leads.deliver(changing_send, self.now)
        self.app.leads.deliver(self.telegram, self.now)
        self.assertEqual([method for method, _ in self.calls], ['sendMessage', 'editMessageText'])
        self.assertIn('В работе', self.calls[-1][1]['text'])

    def test_deleted_telegram_card_is_recreated(self):
        from telegram_client import TelegramMessageMissing
        lead = self.create(); self.app.leads.deliver(self.telegram, self.now)
        self.app.leads.action(lead['id'], 'take', self.actor, 1, self.now)
        def send(method, payload):
            if method == 'editMessageText': raise TelegramMessageMissing()
            return self.telegram(method, payload)
        self.app.leads.deliver(send, self.now)
        self.assertEqual(self.calls[-1][0], 'sendMessage')
        self.assertEqual(self.get(lead['id'])['messageId'], 102)

    def test_webhook_authentication_deduplication_and_queue(self):
        event = {'path': '/api/telegram/webhook', 'httpMethod': 'POST',
                 'headers': {'content-type': 'application/json'}, 'body': json.dumps({'update_id': 123})}
        self.assertEqual(self.app.handle(event)['statusCode'], 401)
        with patch.dict(os.environ, {'TELEGRAM_WEBHOOK_SECRET': 's'*40, 'TELEGRAM_UPDATE_MODE': 'webhook'}):
            event['headers']['x-telegram-bot-api-secret-token'] = 'wrong'
            self.assertEqual(self.app.handle(event)['statusCode'], 401)
            event['headers']['x-telegram-bot-api-secret-token'] = 's'*40
            self.assertEqual(self.app.handle(event)['statusCode'], 200)
            self.assertEqual(self.app.handle(event)['statusCode'], 200)
            calls = []
            self.assertTrue(self.app.leads.process_webhooks(calls.append, self.now))
            self.assertFalse(self.app.leads.process_webhooks(calls.append, self.now))
            self.assertEqual(calls, [{'update_id': 123}])
            for invalid in ({'update_id': True}, {'update_id': 124, 'message': []}):
                event['body'] = json.dumps(invalid)
                self.assertEqual(self.app.handle(event)['statusCode'], 400)


if __name__ == '__main__': unittest.main(verbosity=2)
