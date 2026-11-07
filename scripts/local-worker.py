"""Start the local Telegram worker using the same private configuration as the API."""
import os
from pathlib import Path
import shlex

root = Path(__file__).resolve().parents[1]
for line in (root / '.env').read_text().splitlines():
    if line.strip() and not line.lstrip().startswith('#'):
        key, value = line.split('=', 1)
        parts = shlex.split(value)
        os.environ[key] = parts[0] if parts else ''
from worker import run

if __name__ == '__main__': run()
