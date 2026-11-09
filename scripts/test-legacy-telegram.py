"""Synthetic old/new Telegram routing checks; no external requests."""
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from legacy_telegram import forward_legacy_update

class Routing(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'LEGACY_TELEGRAM_WEBHOOK_URL':'http://autosim:3000/api/telegram/webhook', 'LEGACY_TELEGRAM_WEBHOOK_SECRET':'synthetic'})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_owned_new_card_does_not_forward(self):
        with patch('urllib.request.build_opener') as opener:
            forward_legacy_update({'callback_query':{'data':'asl:take:fixture:1'}}, True)
            opener.assert_not_called()

    def test_old_card_forwards_with_secret(self):
        item={'callback_query':{'data':'lead:old:take'}}
        with patch('urllib.request.build_opener') as opener:
            opener.return_value.open.return_value=io.BytesIO(b'{"ok":true}')
            forward_legacy_update(item,False)
            req=opener.return_value.open.call_args.args[0]
            self.assertEqual(json.loads(req.data),item)
            self.assertEqual(req.get_header('X-telegram-bot-api-secret-token'),'synthetic')

    def test_commands_reach_both_stores(self):
        for command in ['/new','/active@fixture_bot','/done','/retry_failed']:
            with patch('urllib.request.build_opener') as opener:
                opener.return_value.open.return_value=io.BytesIO(b'{"ok":true}')
                forward_legacy_update({'message':{'text':command}},True)
                opener.return_value.open.assert_called_once()

    def test_failure_not_acknowledged(self):
        with patch('urllib.request.build_opener') as opener:
            opener.return_value.open.return_value=io.BytesIO(b'{"ok":false}')
            with self.assertRaises(RuntimeError):forward_legacy_update({'message':{'text':'old comment'}},False)

    def test_destination_is_fixed(self):
        with patch.dict(os.environ,{'LEGACY_TELEGRAM_WEBHOOK_URL':'https://example.com'}):
            with self.assertRaises(RuntimeError):forward_legacy_update({},False)

if __name__=='__main__':unittest.main()
