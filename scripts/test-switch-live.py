"""Cutover failure must restore routing and the sole legacy poller."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('cutover',Path(__file__).with_name('switch-live.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Cutover(unittest.TestCase):
    def test_nginx_failure_restores_old_site_and_poller(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);conf=root/'default.conf';original='proxy_pass http://autosim_app;\n';conf.write_text(original)
            calls=[]
            def inspect(name):
                if name=='nginx':return {'Mounts':[{'Source':str(conf),'Destination':'/etc/nginx/conf.d/default.conf'}]}
                if name=='autosim':return {'Config':{'Env':['TELEGRAM_BOT_TOKEN=fixture','TELEGRAM_ADMIN_CHAT_ID=1','TELEGRAM_WEBHOOK_SECRET=fixture']}}
                return {'State':{'Running':True},'RestartCount':0}
            def run(args,capture=False):
                calls.append(args)
                if args[:4]==['docker','exec','nginx','wget']:return '{"authenticated":false}'
                if args[-3:]==['ps','-q','worker']:return 'new-worker'
                if args[:2]==['docker','logs']:return 'Telegram worker ready: polling'
                if args==['docker','exec','nginx','nginx','-t'] and 'autosim_new_web' in conf.read_text():
                    raise subprocess.CalledProcessError(1,args)
                return ''
            with patch.object(m,'ROOT',root),patch.object(m,'STATE',root/'state'),patch.object(m,'container',side_effect=lambda x:x),patch.object(m,'inspect',side_effect=inspect),patch.object(m,'run',side_effect=run),patch.object(m.os,'chdir'),patch.object(m.time,'sleep'),patch.object(m.sys,'argv',['switch-live.py']):
                with self.assertRaises(subprocess.CalledProcessError):m.main()
            self.assertEqual(conf.read_text(),original)
            self.assertIn(['docker','start','telegram-poller'],calls)
            self.assertIn(m.COMPOSE+['stop','worker'],calls)
            self.assertFalse(json.loads((root/'state/state.json').read_text())['live'])
            self.assertEqual((root/'.env.cutover').stat().st_mode & 0o777,0o600)

if __name__=='__main__':unittest.main()
