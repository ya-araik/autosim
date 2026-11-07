"""Small transactional storage boundary. Production never falls back to memory."""
import copy
import json
import threading

TABLE = "autosim_records"
MAX_ROWS = 10001


class MemoryTransaction:
    def __init__(self, records, now):
        self.records = records
        self.now = now

    def get(self, bucket, key):
        row = self.records.get((bucket, key))
        if not row or row["expires"] <= self.now:
            return None
        return copy.deepcopy(row["value"])

    def put(self, bucket, key, value, expires):
        old = self.records.get((bucket, key))
        self.records[(bucket, key)] = {
            "value": copy.deepcopy(value), "expires": int(expires),
            "created": old["created"] if old else self.now,
        }

    def delete(self, bucket, key):
        self.records.pop((bucket, key), None)

    def scan(self, bucket, since=0, until=9999999999, limit=MAX_ROWS):
        return [copy.deepcopy(row["value"]) for (kind, _), row in
                sorted(self.records.items()) if kind == bucket and
                row["expires"] > self.now and since <= row["created"] < until][:limit]

    def purge(self):
        expired = [key for key, row in self.records.items() if row["expires"] <= self.now]
        for key in expired:
            del self.records[key]
        return len(expired)


class MemoryStore:
    """Injected only by tests; transaction rollback and concurrency are real."""
    kind = "memory-test"

    def __init__(self):
        self.records = {}
        self.lock = threading.RLock()

    def atomic(self, operation, now):
        with self.lock:
            candidate = copy.deepcopy(self.records)
            result = operation(MemoryTransaction(candidate, now))
            self.records = candidate
            return result


class YdbTransaction:
    def __init__(self, tx, now, sdk):
        self.tx, self.now, self.sdk = tx, int(now), sdk

    def query(self, text, values):
        parameters = {}
        declarations = []
        for name, value in values.items():
            type_name = "Uint64" if isinstance(value, int) else "Utf8"
            declarations.append(f"DECLARE ${name} AS {type_name};")
            parameters["$" + name] = (value, getattr(self.sdk.PrimitiveType, type_name))
        rows = []
        with self.tx.execute("\n".join(declarations) + "\n" + text, parameters) as results:
            for result in results:
                rows.extend(result.rows)
        return rows

    def get(self, bucket, key):
        rows = self.query(
            f"SELECT payload FROM `{TABLE}` WHERE bucket=$bucket AND record_id=$key "
            "AND expires_at>$now;", {"bucket": bucket, "key": key, "now": self.now})
        return json.loads(rows[0]["payload"]) if rows else None

    def put(self, bucket, key, value, expires):
        # created_at is the record's original creation, rather than its latest update.
        created = int(value.get("_createdEpoch", self.now))
        self.query(
            f"UPSERT INTO `{TABLE}` (bucket,record_id,payload,created_at,expires_at) "
            "VALUES ($bucket,$key,$payload,$created,$expires);",
            {"bucket": bucket, "key": key, "payload": json.dumps(value, ensure_ascii=False),
             "created": created, "expires": int(expires)})

    def delete(self, bucket, key):
        self.query(f"DELETE FROM `{TABLE}` WHERE bucket=$bucket AND record_id=$key;",
                   {"bucket": bucket, "key": key})

    def scan(self, bucket, since=0, until=9999999999, limit=MAX_ROWS):
        rows = self.query(
            f"SELECT payload FROM `{TABLE}` WHERE bucket=$bucket AND expires_at>$now "
            "AND created_at >= $since AND created_at < $until ORDER BY record_id LIMIT $limit;",
            {"bucket": bucket, "now": self.now, "since": int(since),
             "until": int(until), "limit": int(limit)})
        return [json.loads(row["payload"]) for row in rows]

    def purge(self):
        # TTL normally does this; explicit purge supports a controlled admin action.
        rows = self.query(f"SELECT COUNT(*) AS amount FROM `{TABLE}` WHERE expires_at <= $now;",
                          {"now": self.now})
        self.query(f"DELETE FROM `{TABLE}` WHERE expires_at <= $now;", {"now": self.now})
        return int(rows[0]["amount"]) if rows else 0


class YdbStore:
    kind = "ydb"

    def __init__(self, endpoint, database):
        import ydb
        import ydb.iam
        self.sdk = ydb
        self.driver = ydb.Driver(ydb.DriverConfig(
            endpoint=endpoint, database=database,
            credentials=ydb.iam.MetadataUrlCredentials(),
            root_certificates=ydb.load_ydb_root_certificate()))
        self.driver.wait(timeout=5, fail_fast=True)
        self.pool = ydb.QuerySessionPool(self.driver)
        self.pool.execute_with_retries(f"""
            CREATE TABLE IF NOT EXISTS `{TABLE}` (
                bucket Utf8, record_id Utf8, payload Utf8,
                created_at Uint64, expires_at Uint64,
                PRIMARY KEY (bucket, record_id)
            ) WITH (TTL = Interval("PT0S") ON expires_at AS SECONDS);
        """)

    def atomic(self, operation, now):
        def run(session):
            tx = session.transaction(self.sdk.QuerySerializableReadWrite()).begin()
            try:
                result = operation(YdbTransaction(tx, now, self.sdk))
                tx.commit()
                return result
            except Exception:
                try:
                    tx.rollback()
                except Exception:
                    pass
                raise
        return self.pool.retry_operation_sync(run)
