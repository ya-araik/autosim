"""Public seat availability and transactional local allocation. No customer data leaves this module."""
from datetime import datetime, timedelta
import secrets
from app import DAY, CRM_DAYS, CLUB_TZ, ApiError, fail, stamp, parse_instant
from smartshell import shell_instant

CAPACITY = {'standard': 7, 'pro': 2, 'vip': 1}
NAMES = {'standard': 'Standard', 'pro': 'Pro', 'vip': 'VIP'}
PREFIX = {'standard': 'S', 'pro': 'P', 'vip': 'V'}
SCHEDULE = '''query AutosimSeatAvailability($hosts:[Int!],$page:Int!) {
 hostsOverview { id in_service online_booking_enabled }
 getBookings(hostIds:$hosts,status:"ACTIVE",first:100,page:$page) {
 data { id group hosts from to status } paginatorInfo { hasMorePages } }
}'''


def overlap(a, b):
    return parse_instant(a['startsAt']) < parse_instant(b['endsAt']) and parse_instant(a['endsAt']) > parse_instant(b['startsAt'])


class SeatBooking:
    def __init__(self, app): self.app = app

    def inventory(self, config):
        rows = []
        for tariff, count in CAPACITY.items():
            hosts = (config.get('mapping') or {}).get(tariff, [])
            if len(hosts) != count: fail(503, 'seats_not_configured', 'Расписание обновляется. Позвони в клуб.')
            for n, host in enumerate(hosts, 1):
                rows.append({'id': PREFIX[tariff]+str(n).zfill(2), 'label': NAMES[tariff]+' '+str(n), 'tariff': tariff, 'host': host})
        return rows

    def snapshot(self, now, fresh=False):
        ss = self.app.smartshell
        config = ss.config(now)
        if not ss.sync.enabled(config): fail(503, 'schedule_unavailable', 'Онлайн-расписание временно недоступно. Позвони в клуб.')
        seats = self.inventory(config)
        signature = 'v20:' + str([(s['id'], s['host']) for s in seats]) + ':' + str(config.get('clubId'))
        nonce = secrets.token_hex(12)
        def claim(tx):
            cached = tx.get('seat_cache', 'schedule')
            if not fresh and cached and cached['signature'] == signature and now-cached['at'] < 15: return cached
            lock = tx.get('seat_cache', 'lock')
            if lock and lock['until'] > now: fail(503, 'schedule_refreshing', 'Обновляем места. Повтори через несколько секунд.')
            tx.put('seat_cache', 'lock', {'nonce': nonce, 'until': now+20}, now+30)
        cached = self.app.atomic(claim, now)
        if cached: return seats, cached
        try:
            bookings, equipment = [], []
            for page in range(1, 6):
                data = ss.query(config, SCHEDULE, {'hosts': [s['host'] for s in seats], 'page': page}, now)
                equipment = data['hostsOverview']
                chunk = data['getBookings']
                bookings.extend({'id': b['id'], 'group': b.get('group'), 'hosts': b['hosts'] or [],
                    'startsAt': stamp(shell_instant(b['from']).timestamp()), 'endsAt': stamp(shell_instant(b['to']).timestamp())}
                    for b in chunk['data'] if b['status'] == 'ACTIVE')
                if not chunk['paginatorInfo']['hasMorePages']: break
            else: fail(503, 'schedule_incomplete', 'Не удалось проверить все места. Позвони в клуб.')
            result = {'at': now, 'signature': signature, 'bookings': bookings,
                      'enabled': [h['id'] for h in equipment if not h['in_service'] and h['online_booking_enabled']]}
            self.app.atomic(lambda tx: tx.put('seat_cache', 'schedule', result, now+60), now)
            return seats, result
        finally:
            def release(tx):
                if (tx.get('seat_cache', 'lock') or {}).get('nonce') == nonce: tx.delete('seat_cache', 'lock')
            self.app.atomic(release, now)

    def invalidate(self, tx): tx.delete('seat_cache', 'schedule')

    def occupied(self, tx, seats, snapshot, interval, exclude=None, local_data=None):
        rows,jobs=local_data if local_data is not None else (self.app.scan(tx,'bookings'),None)
        job = (jobs.get('booking:'+exclude) if jobs is not None else tx.get('ss_jobs', 'booking:'+exclude)) if exclude else None
        remote_id = (job or {}).get('remoteId')
        # SmartShell returns one row per host for a multi-host booking. All
        # rows share a server-generated group UUID; they are not competitors.
        own_group = next((b.get('group') for b in snapshot['bookings'] if b['id'] == remote_id), None)
        busy = {s['host'] for s in seats if s['host'] not in snapshot['enabled']}
        for row in snapshot['bookings']:
            if row['id'] == remote_id or (own_group and row.get('group') == own_group): continue
            if overlap(row, interval): busy.update(row['hosts'])
        for row in rows:
            if row['id'] == exclude or not overlap(row, interval): continue
            remote = (jobs.get('booking:'+row['id']) if jobs is not None else tx.get('ss_jobs', 'booking:'+row['id'])) or {}
            # An unresolved cancellation still occupies the remote seat until acknowledged.
            if row['status'] not in {'draft', 'confirmed'}:
                if row['status'] == 'cancelled' and remote.get('remoteId') and remote.get('state') not in {'synced', 'not_needed'}:
                    busy.update(row.get('_hostIds', []))
                continue
            if remote.get('state') == 'conflict' and not remote.get('remoteId'): continue
            if row.get('_hostIds'): busy.update(row['_hostIds'])
            elif remote.get('remoteSnapshot'): busy.update(remote['remoteSnapshot'].get('hosts', []))
            else:
                free = [s['host'] for s in seats if s['tariff'] == row['tariff'] and s['host'] not in busy]
                busy.update(free[:row['participants']])
        return busy

    def prepare(self, value, requested, now, exclude=None):
        start = parse_instant(value['startsAt']).astimezone(CLUB_TZ)
        if start.minute or start.second or value['duration'] not in (60, 120):
            fail(400, 'hourly_session', 'Заезды начинаются каждый час. Выбери 1 или 2 часа.')
        seats, snapshot = self.snapshot(now, fresh=True)
        if not isinstance(requested, list) or not requested or any(not isinstance(s, str) for s in requested) or len(set(requested)) != len(requested):
            fail(400, 'seats_required', 'Выбери места на схеме.')
        selected = [s for s in seats if s['id'] in requested]
        if len(selected) != len(requested) or len(selected) != value['participants']:
            fail(400, 'invalid_seats', 'Проверь выбранные места и комплектацию.')
        value.update(seatIds=[s['id'] for s in selected], seatLabels=[s['label'] for s in selected], _hostIds=[s['host'] for s in selected], allocationState='pending')
        self.price_selection(value, value['seatIds'])
        self.app.atomic(lambda tx: self.assert_free(tx, value, seats, snapshot, now, exclude), now)
        return seats, snapshot

    @staticmethod
    def price_selection(value, requested):
        """Canonical seat IDs determine price; never trust client class or amount."""
        from app import PRICES, VR_PRICES
        catalog={f'{prefix}{n:02}':(tariff,label+' '+str(n))
                 for tariff,prefix,label,count in [('standard','S','Standard',7),('pro','P','Pro',2),('vip','V','VIP',1)]
                 for n in range(1,count+1)}
        if not isinstance(requested,list) or not 1<=len(requested)<=10 or any(not isinstance(s,str) or s not in catalog for s in requested) or len(set(requested))!=len(requested):
            fail(400,'invalid_seats','Выбери места на схеме.')
        if value['participants']!=len(requested):fail(400,'invalid_seats','Число гостей должно совпадать с выбранными местами.')
        items=[{'seatId':s,'tariff':catalog[s][0],'label':catalog[s][1],'priceRub':PRICES[catalog[s][0]][value['duration']]} for s in requested]
        classes={i['tariff'] for i in items}; vr=VR_PRICES[value['duration']]
        base=items[0]['priceRub'] if len(classes)==1 else None
        value.update(seatIds=requested[:],seatLabels=[i['label'] for i in items],items=items,
                     tariff=next(iter(classes)) if len(classes)==1 else 'mixed',
                     basePricePerPersonRub=base,vrPricePerPersonRub=vr,
                     priceWithVrPerPersonRub=base+vr if base is not None else None,
                     pricePerPersonRub=(base+(vr if value['vrCount']==value['participants'] else 0)) if base is not None and value['vrCount'] in (0,value['participants']) else None,
                     priceRub=sum(i['priceRub'] for i in items)+vr*value['vrCount'])

    def preflight(self, value, now, exclude=None):
        try:return self._preflight(value,now,exclude)
        except ApiError as error:
            if exclude and error.code == 'seat_unavailable':
                saved=self.app.atomic(lambda tx:tx.get('bookings',exclude),now)
                # A rejected move must not mark the still-valid original slot
                # as conflicted. Only report a collision with the current slot.
                if saved and all(saved.get(k)==value.get(k) for k in ('startsAt','endsAt','_hostIds')):
                    self.app.smartshell.sync.stamp_result('booking:'+exclude,now,'conflict',code='selected_seat_busy')
            raise

    def _preflight(self, value, now, exclude=None):
        """Admin/owner edits get the same capacity checks as customer requests."""
        if value['status'] not in {'draft', 'confirmed'} or not self.app.smartshell.sync.enabled(self.app.smartshell.config(now)): return None
        requested = value.get('seatIds')
        if not requested:
            seats, snapshot = self.snapshot(now, fresh=True)
            busy = self.app.atomic(lambda tx: self.occupied(tx, seats, snapshot, value, exclude), now)
            selected = [s for s in seats if s['tariff'] == value['tariff'] and s['host'] not in busy][:value['participants']]
            if len(selected) != value['participants']: fail(409, 'seat_unavailable', 'На этот сеанс недостаточно свободных мест. Выбери другое время.')
            value.update(seatIds=[s['id'] for s in selected], seatLabels=[s['label'] for s in selected], _hostIds=[s['host'] for s in selected], allocationState='pending')
            self.price_selection(value, value['seatIds'])
            return seats, snapshot
        return self.prepare(value, requested, now, exclude)

    def assert_free(self, tx, value, seats, snapshot, now, exclude=None):
        # Every allocation touches the same calendar lock. Serializable transactions
        # cannot both win even when a store's scan does not lock absent rows.
        key = value['startsAt'][:10]
        lock = tx.get('seat_days', key) or {'revision': 0}
        tx.put('seat_days', key, {'revision': lock['revision']+1}, now+100*DAY)
        # Also lock the following UTC day for intervals crossing midnight.
        end_key = value['endsAt'][:10]
        if end_key != key:
            other = tx.get('seat_days', end_key) or {'revision': 0}
            tx.put('seat_days', end_key, {'revision': other['revision']+1}, now+100*DAY)
        if set(value['_hostIds']) & self.occupied(tx, seats, snapshot, value, exclude):
            fail(409, 'seat_unavailable', 'Это место уже занято. Выбери другое место или сеанс.')

    def availability(self, request, now):
        try:
            day = datetime.strptime(request.query.get('date', ''), '%Y-%m-%d').date()
            duration = int(request.query.get('duration', '60'))
            today = datetime.fromtimestamp(now, CLUB_TZ).date()
            if not 0 <= (day-today).days <= 90 or duration not in (60, 120): raise ValueError()
        except (ValueError, TypeError): fail(400, 'invalid_session', 'Выбери дату и длительность заезда.')
        seats, snapshot = self.snapshot(now)
        def read(tx):
            sessions = []
            local_data=(self.app.scan(tx,'bookings'),{j['id']:j for j in self.app.scan(tx,'ss_jobs')})
            for hour in [0, 1, *range(14, 24)]:
                start = datetime.combine(day, datetime.min.time(), CLUB_TZ) + timedelta(hours=hour)
                end = start+timedelta(minutes=duration)
                if (hour if hour >= 14 else hour+24)*60+duration > 26*60: continue
                interval = {'startsAt': stamp(start.timestamp()), 'endsAt': stamp(end.timestamp())}
                busy = self.occupied(tx, seats, snapshot, interval, local_data=local_data)
                past = start.timestamp() < now+900
                sessions.append(dict(interval, time=start.strftime('%H:%M'),
                    seats=[{'id': s['id'], 'available': not past and s['host'] not in busy} for s in seats]))
            return {'date': day.isoformat(), 'duration': duration, 'timezone': 'Asia/Yekaterinburg',
                    'checkedAt': stamp(snapshot['at']), 'refreshAfter': 20,
                    'seats': [{k: s[k] for k in ('id','label','tariff')} for s in seats], 'sessions': sessions}
        return self.app.atomic(read, now)

    def notice(self, tx, job, now):
        if job.get('kind') != 'booking': return
        booking = tx.get('bookings', job['bookingId'])
        if not booking: return
        state = job['state']
        allocation = 'reserved' if state == 'synced' else 'conflict' if state == 'conflict' else 'pending'
        booking['allocationState'] = allocation
        booking['allocationMessage'] = ('Место занято или расписание изменилось. Свяжитесь с гостем и подберите другой сеанс.' if state == 'conflict'
            else 'Не удалось подтвердить место в SmartShell. Проверьте синхронизацию в админке.' if state in {'error','uncertain'} else '')
        tx.put('bookings', booking['id'], booking, now+CRM_DAYS*DAY)
        self.invalidate(tx)
        if state not in {'conflict', 'error', 'uncertain'}: return
        fingerprint = str(booking['version'])+':'+str(job.get('code'))
        if job.get('noticeKey') == fingerprint: return
        job['noticeKey'] = fingerprint
        tx.put('ss_jobs', job['id'], job, now+CRM_DAYS*DAY)
        guest = tx.get('guests', booking.get('guestId') or '') or {}
        if not booking.get('_memberId') or guest.get('_ssFixture'): return
        for owner in self.app.booking_bot.owners(tx):
            self.app.members.queue_notification(tx, booking, owner, now)
            key = self.app.booking_bot.delivery_key(booking['id'], owner)
            notification = tx.get('booking_notifications', key)
            notification.update(forceNew=True, leaseToken='', leaseUntil=0)
            tx.put('booking_notifications', key, notification, now+30*DAY)
