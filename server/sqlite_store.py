"""Durable single-server storage. Same transaction contract as YDB, no SQL interpolation."""
import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from storage import MAX_ROWS


class Transaction:
    def __init__(self, connection, now): self.db,self.now=connection,int(now)
    def get(self, bucket, key):
        row=self.db.execute('SELECT payload FROM records WHERE bucket=? AND record_id=? AND expires>?',(bucket,key,self.now)).fetchone()
        return json.loads(row[0]) if row else None
    def put(self,bucket,key,value,expires):
        self.db.execute('INSERT INTO records VALUES(?,?,?,?,?) ON CONFLICT(bucket,record_id) DO UPDATE SET payload=excluded.payload,expires=excluded.expires',
            (bucket,key,json.dumps(value,ensure_ascii=False),int(value.get('_createdEpoch',self.now)),int(expires)))
    def delete(self,bucket,key): self.db.execute('DELETE FROM records WHERE bucket=? AND record_id=?',(bucket,key))
    def scan(self,bucket,since=0,until=9999999999,limit=MAX_ROWS):
        return [json.loads(r[0]) for r in self.db.execute('SELECT payload FROM records WHERE bucket=? AND expires>? AND created>=? AND created<? ORDER BY record_id LIMIT ?',
            (bucket,self.now,int(since),int(until),int(limit)))]
    def purge(self): return self.db.execute('DELETE FROM records WHERE expires<=?',(self.now,)).rowcount


class SQLiteStore:
    kind='sqlite'
    def __init__(self,path):
        self.path=str(Path(path).resolve());Path(self.path).parent.mkdir(parents=True,exist_ok=True)
        with closing(sqlite3.connect(self.path)) as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE IF NOT EXISTS records(bucket TEXT NOT NULL,record_id TEXT NOT NULL,payload TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(bucket,record_id))')
        os.chmod(self.path,0o600)
    def atomic(self,operation,now):
        db=sqlite3.connect(self.path,timeout=20,isolation_level=None)
        try:
            db.execute('BEGIN IMMEDIATE')
            result=operation(Transaction(db,now));db.execute('COMMIT');return result
        except BaseException:
            if db.in_transaction: db.execute('ROLLBACK')
            raise
        finally: db.close()
