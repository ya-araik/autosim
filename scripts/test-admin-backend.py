"""Offline security/domain regressions. No cloud, network or real credentials."""
import concurrent.futures
import copy
import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from app import Application, Config, COOKIE, DAY, make_password_hash
from storage import MemoryStore, YdbTransaction

ORIGIN = "https://test.autosim.example"
TEST_PASSWORD = " Test-only credential  "
HASH = make_password_hash(TEST_PASSWORD, iterations=200000, salt=b"test-salt-24-bytes-only!!")


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.now = int(datetime(2026, 9, 19, 7, tzinfo=timezone.utc).timestamp())
        self.store = MemoryStore()
        self.config = Config("test-admin", HASH, "test-only-session-secret-32-characters", (ORIGIN,))
        self.app = Application(self.config, self.store, lambda: self.now)
        self.cookie = self.csrf = ""

    def call(self, path, method="GET", body=None, authenticated=True, origin=ORIGIN,
             ip="203.0.113.20", headers=None, query=None, app=None):
        request_headers = {"Content-Type": "application/json"}
        if origin is not None:
            request_headers["Origin"] = origin
        if authenticated:
            request_headers.update(Cookie=self.cookie, **{"X-CSRF-Token": self.csrf})
        request_headers.update(headers or {})
        event = {"path": path, "httpMethod": method, "headers": request_headers,
                 "requestContext": {"identity": {"sourceIp": ip}},
                 "queryStringParameters": query or {}, "body": json.dumps(body or {})}
        response = (app or self.app).handle(event)
        value = response["body"]
        if value and "application/json" in response["headers"].get("Content-Type", ""):
            value = json.loads(value)
        return response["statusCode"], value, response

    def login(self, password=TEST_PASSWORD, ip="203.0.113.20"):
        status, body, response = self.call("/api/admin/login", "POST",
            {"username": "test-admin", "password": password}, authenticated=False, ip=ip)
        if status == 200:
            self.cookie = response["headers"]["Set-Cookie"].split(";", 1)[0]
            self.csrf = body["csrf"]
        return status, body, response

    def create_booking(self, **changes):
        body = {"startsAt": "2026-09-19T18:00:00+05:00", "guestName": "Test guest",
                "phone": "+70000000000", "duration": 60, "tariff": "standard", "participants": 1}
        body.update(changes)
        return self.call("/api/admin/bookings", "POST", body)

    def analytics(self, **changes):
        data = {"sessionId": "test-session-000001", "visitorId": "test-visitor-000001",
                "event": "page_view", "path": "/?email=private@example.test",
                "consent": True, "ipConsent": True, "consentVersion": "2026-09-19",
                "referrer": "https://search.example/path?phone=70000000000",
                "utm": {"source": "search", "campaign": "club-launch"}, "properties": {}}
        data.update(changes)
        return self.call("/api/analytics", "POST", data, authenticated=False,
                         headers={"X-Forwarded-For": "198.51.100.200", "User-Agent": "Mozilla Mobile Chrome/140"})

    def test_no_private_bootstrap_or_anonymous_reports(self):
        self.assertEqual(self.call("/api/admin/session")[1], {"authenticated": False, "user": None, "csrf": None})
        for path in ("overview", "bookings", "guests", "settings", "health", "events", "audit", "export"):
            self.assertEqual(self.call("/api/admin/" + path)[0], 401, path)
        self.assertEqual(self.call("/api/unknown")[0], 404)

    def test_exact_password_secure_cookie_session_logout(self):
        self.assertEqual(self.login(TEST_PASSWORD.strip())[0], 401)
        status, body, response = self.login()
        self.assertEqual(status, 200)
        cookie = response["headers"]["Set-Cookie"]
        for part in (COOKIE, "Secure", "HttpOnly", "SameSite=Strict", "Path=/"):
            self.assertIn(part, cookie)
        self.assertNotIn("Domain=", cookie)
        self.assertEqual(self.call("/api/admin/session")[1]["user"]["username"], "test-admin")
        self.assertTrue(self.call("/api/admin/session")[1]["user"]["isOwner"])
        serialized = json.dumps(list(self.store.records.values()))
        self.assertNotIn(TEST_PASSWORD, serialized)
        self.assertNotIn(self.cookie.split("=", 1)[1], serialized)
        self.assertEqual(self.call("/api/admin/logout", "POST")[0], 200)
        self.assertFalse(self.call("/api/admin/session")[1]["authenticated"])

    def test_session_expiry_and_password_rotation(self):
        self.login()
        rotated = Config("test-admin", make_password_hash("different", 200000), self.config.secret, (ORIGIN,))
        other = Application(rotated, self.store, lambda: self.now)
        self.assertEqual(self.call("/api/admin/health", app=other)[0], 401)
        self.now += 8 * 3600
        self.assertEqual(self.call("/api/admin/health")[0], 401)

    def test_origin_csrf_and_preflight(self):
        self.assertEqual(self.call("/api/admin/login", "POST", {}, origin=None)[0], 403)
        self.assertEqual(self.call("/api/admin/login", "POST", {}, origin="https://evil.example")[0], 403)
        self.login()
        self.assertEqual(self.call("/api/admin/logout", "POST", headers={"X-CSRF-Token": "wrong"})[0], 403)
        self.assertEqual(self.call("/api/admin/logout", "POST", origin=None)[0], 403)
        self.assertEqual(self.call("/api/admin/health", headers={"Sec-Fetch-Site": "cross-site"})[0], 403)
        self.assertEqual(self.call("/api/analytics", "OPTIONS")[0], 204)
        self.assertEqual(self.call("/api/analytics", "OPTIONS", origin="https://evil.example")[0], 403)

    def test_persistent_login_limit_and_untrusted_forwarded_ip(self):
        for _ in range(6):
            self.assertEqual(self.login("wrong")[0], 401)
        restarted = Application(self.config, self.store, lambda: self.now)
        result = self.call("/api/admin/login", "POST", {"username": "test-admin", "password": TEST_PASSWORD},
            authenticated=False, headers={"X-Forwarded-For": "198.51.100.9"}, app=restarted)
        self.assertEqual(result[0], 429)
        self.now += 901
        self.assertEqual(self.login()[0], 200)

    def test_global_rate_limit_creates_no_rotating_id_rows(self):
        for key, count in (("analytics:global", 3000), ("login:global", 100)):
            self.store.atomic(lambda tx: tx.put("limits", key, {"count": count, "resetAt": self.now + DAY}, self.now + DAY), self.now)
        before = copy.deepcopy(self.store.records)
        self.assertEqual(self.analytics(sessionId="rotated-session-001")[0], 429)
        self.assertEqual(self.login(ip="203.0.113.99")[0], 429)
        self.assertEqual(before, self.store.records)

    def test_bookings_default_draft_real_price_no_price_injection(self):
        self.login()
        self.assertEqual(self.create_booking(status="confirmed")[0], 400)
        self.assertEqual(self.create_booking(priceRub=1)[0], 400)
        self.assertEqual(self.create_booking(unknown="x")[0], 400)
        status, booking, _ = self.create_booking(tariff="vip", duration=120, participants=7, vr=True)
        self.assertEqual(status, 201)
        self.assertEqual((booking["status"], booking["pricePerPersonRub"], booking["priceRub"]), ("draft", 2300, 16100))
        self.assertNotIn("_createdEpoch", booking)

    def test_current_standard_prices(self):
        self.login()
        for duration, price in ((30, 400), (60, 700), (120, 1200)):
            with self.subTest(duration=duration):
                status, booking, _ = self.create_booking(duration=duration, participants=2)
                self.assertEqual(status, 201)
                self.assertEqual(booking['priceRub'], price * 2)

    def test_opening_hours_and_midnight(self):
        self.login()
        for instant, duration, expected in (("2026-09-20T00:30:00+05:00", 60, 201),
                ("2026-09-20T01:30:00+05:00", 30, 201), ("2026-09-20T01:30:00+05:00", 60, 400),
                ("2026-09-20T02:00:00+05:00", 30, 400), ("2026-09-19T13:59:00+05:00", 60, 400),
                ("2026-09-19T14:00:00+05:00", 60, 201), ("2026-09-19T14:00:01+05:00", 60, 400)):
            with self.subTest(instant=instant, duration=duration):
                self.assertEqual(self.create_booking(startsAt=instant, duration=duration)[0], expected)
        self.assertEqual(self.create_booking(startsAt="2026-09-19T18:00:00")[0], 400)

    def test_mixed_vr_matches_public_plan(self):
        self.login()
        status, value, _ = self.create_booking(tariff="vip", duration=120, participants=3, vrCount=2, vr=True)
        self.assertEqual(status, 201)
        self.assertEqual((value["priceRub"], value["pricePerPersonRub"], value["basePricePerPersonRub"], value["priceWithVrPerPersonRub"]), (6100, None, 1500, 2300))
        self.assertEqual(self.create_booking(participants=2, vrCount=3)[0], 400)
        self.assertEqual(self.create_booking(vrCount=True)[0], 400)
        path = "/api/admin/bookings/" + value["id"]
        self.assertEqual(self.call(path, "PATCH", {"version": 1, "status": "cancelled"})[0], 200)
        self.assertEqual(self.call(path, "PATCH", {"version": 2, "vr": True})[0], 409)

    def test_confirm_complete_version_and_closed_record_invariants(self):
        self.login()
        _, booking, _ = self.create_booking()
        path = "/api/admin/bookings/" + booking["id"]
        self.assertEqual(self.call(path, "PATCH", {"status": "confirmed", "version": 99})[0], 409)
        status, booking, _ = self.call(path, "PATCH", {"status": "confirmed", "version": 1})
        self.assertEqual((status, booking["status"]), (200, "confirmed"))
        self.assertEqual(self.call(path, "PATCH", {"status": "draft", "version": 2})[0], 409)
        self.assertEqual(self.call(path, "PATCH", {"status": "completed", "version": 2})[0], 400)
        self.assertEqual(self.call(path, "PATCH", {"phone": "", "version": 2})[0], 400)
        self.now += 7 * 3600 + 1
        status, booking, _ = self.call(path, "PATCH", {"status": "completed", "version": 2})
        self.assertEqual((status, booking["status"]), (200, "completed"))
        self.assertEqual(self.call(path, "PATCH", {"participants": 2, "version": 3})[0], 409)
        self.assertEqual(self.call(path, "PATCH", {"startsAt": "2026-09-19T18:00:00+05:00", "notes": "Reviewed", "version": 3})[0], 200)

    def test_past_confirmation_and_missing_contact(self):
        self.login()
        for changes in ({"startsAt": "2026-09-18T18:00:00+05:00"}, {"phone": ""}, {"guestName": ""}):
            _, value, _ = self.create_booking(**changes)
            self.assertEqual(self.call("/api/admin/bookings/" + value["id"], "PATCH", {"version": 1, "status": "confirmed"})[0], 400)

    def test_concurrent_updates_one_winner(self):
        self.login()
        _, booking, _ = self.create_booking()
        def update(note):
            return self.call("/api/admin/bookings/" + booking["id"], "PATCH", {"version": 1, "notes": note})[0]
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            statuses = list(pool.map(update, ("first", "second")))
        self.assertEqual(sorted(statuses), [200, 409])

    def test_guest_evidence_delete_and_linked_contact_erasure(self):
        self.login()
        self.assertEqual(self.call("/api/admin/guests", "POST", {"name": "Guest", "skillVerified": True})[0], 400)
        _, guest, _ = self.call("/api/admin/guests", "POST", {"name": "Guest", "skillNote": "Instructor observation", "skillVerified": True})
        self.assertTrue(guest["skillVerifiedAt"])
        path = "/api/admin/guests/" + guest["id"]
        _, guest, _ = self.call(path, "PATCH", {"version": 1, "skillNote": "Revised observation"})
        self.assertFalse(guest["skillVerified"])
        self.assertIsNone(guest["skillVerifiedAt"])
        _, booking, _ = self.create_booking(guestId=guest["id"])
        self.assertEqual(self.call(path, "DELETE", {"version": 2})[0], 200)
        self.assertEqual(self.call(path)[0], 404)
        record = self.call("/api/admin/bookings/" + booking["id"])[1]
        self.assertEqual((record["guestId"], record["phone"], record["email"], record["version"]), (None, "", "", 2))

    def test_analytics_consent_privacy_allowlist_and_authoritative_ip(self):
        for changes in ({"consent": False}, {"consentVersion": "old"}, {"email": "secret"},
                        {"properties": {"formContent": "secret"}}, {"path": "/adminka"},
                        {"properties": {"target": "arbitrary-private-text"}}, {"ip": "198.51.100.1"}):
            self.assertEqual(self.analytics(**changes)[0], 400, changes)
        self.assertEqual(self.analytics(utm={"source": "search", "term": "private@example.test", "content": "70000000000"})[0], 202)
        self.login()
        events = self.call("/api/admin/events")[1]["items"]
        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual((event["ip"], event["path"], event["referrer"]), ("203.0.113.20", "/", "search.example"))
        self.assertEqual(event["utm"], {"source": "search"})
        self.assertEqual((event["device"], event["browser"]), ("mobile", "Chrome"))
        self.assertNotIn("userAgent", event)
        self.assertNotIn("private@example.test", json.dumps(event))

    def test_no_ip_without_specific_consent_or_setting(self):
        self.analytics(ipConsent=False)
        self.login()
        self.call("/api/admin/settings", "PATCH", {"version": 1, "collectFullIp": False})
        self.analytics()
        self.assertTrue(all(row.get("ip") is None for row in self.call("/api/admin/events")[1]["items"]))
        self.call("/api/admin/settings", "PATCH", {"version": 2, "analyticsEnabled": False})
        self.assertEqual(self.analytics()[1], {"accepted": False, "reason": "disabled"})
        self.assertEqual(self.call("/api/admin/events")[1]["total"], 2)

    def test_overview_zero_real_counts_and_distinct_intent(self):
        self.login()
        overview = self.call("/api/admin/overview")[1]
        for key in ("visits", "sessions", "consentedUsers", "callClicks", "bookingIntents", "confirmedBookings", "bookingsTotal", "guestsTotal"):
            self.assertEqual(overview[key], 0, key)
        self.analytics()
        self.analytics(event="click", properties={"target": "call"})
        self.analytics(event="booking_intent", properties={"target": "smartgamer"})
        self.create_booking()
        overview = self.call("/api/admin/overview")[1]
        self.assertEqual([overview[key] for key in ("visits", "sessions", "consentedUsers", "callClicks", "bookingIntents", "confirmedBookings", "bookingsTotal")], [1, 1, 1, 1, 1, 0, 1])
        visitor = self.call("/api/admin/visitors")[1]["items"][0]
        self.assertEqual((visitor["sessions"], visitor["eventCount"]), (1, 3))
        self.assertEqual(self.call("/api/admin/export", query={"resource": "visitors"})[0], 200)

    def test_retention_and_purge(self):
        self.login()
        self.analytics()
        self.create_booking()
        self.now += 31 * DAY
        self.assertEqual(self.store.atomic(lambda tx: tx.scan("events"), self.now), [])
        self.assertEqual(len(self.store.atomic(lambda tx: tx.scan("bookings"), self.now)), 1)
        self.assertTrue(self.store.atomic(lambda tx: tx.scan("audit"), self.now))
        result = self.app.handle({"task": "purge"})
        self.assertGreater(result["purged"], 0)
        self.assertFalse(any(row["expires"] <= self.now for row in self.store.records.values()))
        self.now += 335 * DAY
        self.assertEqual(self.store.atomic(lambda tx: tx.scan("bookings"), self.now), [])
        self.assertEqual(self.store.atomic(lambda tx: tx.scan("audit"), self.now), [])

    def test_export_formula_escaping_and_no_sql_interpolation(self):
        self.login()
        dangerous = '=HYPERLINK("https://evil.invalid")'
        self.call("/api/admin/guests", "POST", {"name": dangerous, "phone": "+70000000000", "notes": "'; DROP TABLE autosim_records; --"})
        status, output, response = self.call("/api/admin/export", query={"resource": "guests"})
        self.assertEqual(status, 200)
        self.assertTrue(output.startswith("\ufeff"))
        self.assertIn("'=HYPERLINK", output)
        self.assertIn("'+70000000000", output)
        self.assertIn("attachment;", response["headers"]["Content-Disposition"])
        self.assertEqual(self.call("/api/admin/guests")[1]["total"], 1)
        for value in ("=SUM(A1)", "  +cmd", "-1", "@a", "\ttext", "\rtext"):
            self.assertTrue(Application.csv_cell(value).startswith("'"), value)

    def test_malformed_types_never_internal_error(self):
        self.login()
        for field in ("tariff", "status", "duration", "participants", "vr", "vrCount", "startsAt", "guestName", "guestId"):
            self.assertEqual(self.create_booking(**{field: []})[0], 400, field)
        for field in ("event", "path", "sessionId", "visitorId"):
            self.assertEqual(self.analytics(**{field: {}})[0], 400, field)
        self.assertEqual(self.analytics(properties=[])[0], 400)
        self.assertEqual(self.call("/api/admin/guests", "POST", {"name": "x", "status": []})[0], 400)
        for query in ({"period": "no"}, {"from": "0001-01-01", "to": "0001-01-02"}, {"from": "2026-01-01", "to": "2026-12-01"}):
            self.assertEqual(self.call("/api/admin/overview", query=query)[0], 400)

    def test_orenburg_date_filters_and_pagination(self):
        self.login()
        self.create_booking(startsAt="2026-09-20T00:30:00+05:00")
        self.assertEqual(self.call("/api/admin/bookings", query={"from": "2026-09-20", "to": "2026-09-20"})[1]["total"], 1)
        self.assertEqual(self.call("/api/admin/bookings", query={"from": "2026-09-19", "to": "2026-09-19"})[1]["total"], 0)
        for name in ("First guest", "Second guest", "Third guest"):
            self.call("/api/admin/guests", "POST", {"name": name})
        page = self.call("/api/admin/guests", query={"limit": "2"})[1]
        self.assertEqual((len(page["items"]), page["total"], page["nextOffset"]), (2, 3, 2))
        self.assertEqual(self.call("/api/admin/guests", query={"search": "second"})[1]["total"], 1)


class AdapterTests(unittest.TestCase):
    def test_parameter_values_do_not_enter_yql(self):
        class PrimitiveType:
            Uint64 = "Uint64"
            Utf8 = "Utf8"
        class SDK:
            pass
        SDK.PrimitiveType = PrimitiveType
        class Results:
            def __enter__(self): return iter([])
            def __exit__(self, *_): pass
        class TX:
            def execute(self, query, parameters):
                self.query, self.parameters = query, parameters
                return Results()
        tx = TX()
        value = "x'; DROP TABLE autosim_records;--"
        YdbTransaction(tx, 123, SDK).put("guests", "safe-id", {"name": value}, 456)
        self.assertNotIn(value, tx.query)
        self.assertIn(value, tx.parameters["$payload"][0])
        self.assertEqual(tx.parameters["$expires"], (456, "Uint64"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
