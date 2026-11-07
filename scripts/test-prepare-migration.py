"""Migration copies only necessary settings and never overwrites an existing env."""
import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).with_name('prepare-migration.py'))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class PrepareTest(unittest.TestCase):
    def old(self):
        return {'TELEGRAM_BOT_TOKEN': '123456789:' + 'x'*35, 'TELEGRAM_ADMIN_CHAT_ID': '123456789',
                'TELEGRAM_PROXY_URL': 'http://hysteria:8080', 'NEXT_PUBLIC_SITE_URL': 'https://auto-sim.ru',
                'MONGODB_URI': 'mongodb://fixture-only', 'UNRELATED_SECRET': 'do-not-copy'}

    def test_config_and_no_overwrite(self):
        values = prepare.configuration(self.old(), 'admin333', 'fixture-password-only')
        self.assertEqual(values['TELEGRAM_UPDATE_MODE'], 'disabled')
        self.assertEqual(values['TELEGRAM_PROXY_URL'], 'http://hysteria:8080')
        self.assertEqual(values['BOOKING_OWNER_ID'], '123456789')
        self.assertNotIn('MONGODB_URI', values)
        self.assertNotIn('UNRELATED_SECRET', values)
        self.assertNotEqual(values['ADMIN_PASSWORD_HASH'], 'fixture-password-only')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env'
            prepare.write_env(path, values)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            previous = path.read_bytes()
            with self.assertRaises(FileExistsError): prepare.write_env(path, {})
            self.assertEqual(path.read_bytes(), previous)

    def test_group_and_bad_input(self):
        old = self.old(); old['TELEGRAM_ADMIN_CHAT_ID'] = '-100123456789'
        self.assertEqual(prepare.configuration(old, 'admin333', 'fixture-password-only')['BOOKING_OWNER_ID'], '')
        for key, value in [('TELEGRAM_BOT_TOKEN', 'invalid'), ('TELEGRAM_ADMIN_CHAT_ID', 'invalid'), ('TELEGRAM_PROXY_URL', "http://proxy\nINJECT=1")]:
            old = self.old(); old[key] = value
            with self.assertRaises(ValueError): prepare.configuration(old, 'admin333', 'fixture-password-only')


if __name__ == '__main__': unittest.main(verbosity=2)
