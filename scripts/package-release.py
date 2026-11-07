"""Allowlisted, data-free installation archive. Run from the project root."""
from pathlib import Path
import hashlib,json,re,zipfile

ROOT=Path(__file__).resolve().parents[1]
PUBLIC_EXCLUDE={'apple-glass.css','apple-glass.js','apple-v1.css','old.html','osn.html','visit.html','club-intro.gif','servers-1680.webp','servers-840.webp'}
def files():
    exact=['.gitignore','LOCAL.md','scripts/local-server.py','scripts/local-worker.py','package-lock.json','README.md','AGENTS.md','Dockerfile','compose.yaml','Caddyfile','.dockerignore','.env.example','package.json',
        'docs/release-checks.md','scripts/setup.py','scripts/worker.py','scripts/package-release.py','scripts/test-all.py','scripts/check.mjs',
        'scripts/serve.mjs','.agents/skills/autosim-glass/SKILL.md']
    paths=[ROOT/n for n in exact]
    paths += list((ROOT/'server').glob('*.py'))+[ROOT/'server/requirements.txt']
    paths += [p for p in (ROOT/'scripts').glob('test-*.py') if p.name != 'test-deploy-admin.py']+[p for p in (ROOT/'scripts').glob('test-*.mjs') if p.name != 'test-booking-telegram.mjs']
    paths += [p for p in (ROOT/'public').rglob('*') if p.is_file() and 'editions' not in p.relative_to(ROOT/'public').parts and p.name not in PUBLIC_EXCLUDE]
    return sorted(set(paths),key=lambda p:p.relative_to(ROOT).as_posix())

def package(destination=None):
    target=destination or ROOT/'output/autosim-source.zip';target.parent.mkdir(exist_ok=True,parents=True)
    manifest={}
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for path in files():
            name=path.relative_to(ROOT).as_posix()
            if path.is_symlink() or not path.resolve().is_relative_to(ROOT):raise ValueError('Unsafe source path')
            if any(part in {'.runtime','.env','__pycache__'} for part in path.parts) or path.suffix in {'.sqlite3','.db','.pem','.key'}:raise ValueError('Private file selected')
            content=path.read_bytes()
            if path.suffix in {'.py','.js','.mjs','.html','.css','.md','.yaml','.json'}:
                text=content.decode('utf-8')
                if re.search(r'(?i)(?:BEGIN (?:RSA |EC )?PRIVATE KEY|AQVN[A-Za-z0-9_-]{25,}|t1\.[A-Za-z0-9_-]{80,})',text):raise ValueError('Possible credential: '+name)
            info=zipfile.ZipInfo('autosim/'+name,(2026,10,25,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.create_system=3;info.external_attr=0o100644<<16
            archive.writestr(info,content)
            manifest[name]=hashlib.sha256(content).hexdigest()
        info=zipfile.ZipInfo('autosim/SHA256SUMS.json',(2026,10,25,0,0,0));info.create_system=3;info.external_attr=0o100644<<16
        archive.writestr(info,json.dumps(manifest,indent=2))
    print(json.dumps({'archive':target.name,'files':len(manifest),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}))
    return target

if __name__=='__main__':package()
