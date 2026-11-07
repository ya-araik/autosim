"""Run local regressions with isolated synthetic integration fixtures."""
import os,subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
env={**os.environ,'SMARTSHELL_WRITE_CLUB_ID':'99999','PYTHONIOENCODING':'utf-8'}
failed=[]
for path in sorted((root/'scripts').glob('test-*.py')):
    if path.name=='test-all.py':continue
    print('\n'+path.name,flush=True)
    if subprocess.run([sys.executable,str(path)],cwd=root,env=env).returncode:failed.append(path.name)
if failed:raise SystemExit('Failed: '+', '.join(failed))
print('All Python regressions passed.')
