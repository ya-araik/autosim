"""Local staff roles. The environment-owned principal cannot be delegated or edited."""
import hmac
import re
import uuid
from contextvars import ContextVar
from app import fail, fields, make_password_hash, stamp, text_field

ACTOR = ContextVar('autosim_actor', default=None)
PERMISSIONS = {
    'bookings.read': 'Просматривать записи', 'bookings.write': 'Создавать и менять записи',
    'profiles.read': 'Просматривать клиентов', 'profiles.write': 'Редактировать карточки клиентов',
    'profiles.link': 'Связывать клиентов со SmartShell',
    'game.read': 'Просматривать результаты игры', 'game.write': 'Управлять игрой и проверять результаты',
    'rewards.redeem': 'Списывать час лидера', 'analytics.read': 'Смотреть аналитику сайта',
    'audit.read': 'Смотреть журнал сотрудников', 'data.export': 'Выгружать данные',
    'smartshell.clients': 'SmartShell: поиск клиентов',
    'smartshell.bookings': 'SmartShell: расписание броней',
    'smartshell.clients.write': 'SmartShell: создавать тестовые профили',
    'smartshell.bookings.write': 'SmartShell: синхронизировать тестовые брони',
    'smartshell.equipment': 'SmartShell: состояние кокпитов',
}
FOREVER = 9999999999


class AdminAccess:
    def __init__(self, app):
        self.app = app

    def owner(self):
        return {'username': self.app.config.username, 'isOwner': True, 'roleName': 'Владелец',
                'permissions': sorted(PERMISSIONS)}

    def public(self, tx, staff):
        role = tx.get('admin_roles', staff['roleId'])
        if not role or staff.get('disabled'):
            return None
        return {'username': staff['username'], 'id': staff['id'], 'isOwner': False,
                'name': staff['name'], 'roleId': role['id'], 'roleName': role['name'],
                'permissions': role['permissions']}

    def tag(self, staff):
        return self.app.digest(staff['passwordHash'] + staff['username'] + str(staff['authVersion']))

    def credentials(self, username, now):
        if hmac.compare_digest(username.encode(), self.app.config.username.encode()):
            return self.app.config.password_hash, self.owner(), self.app.digest(self.app.config.password_hash + self.app.config.username)
        def read(tx):
            lookup = tx.get('admin_names', username.casefold())
            staff = tx.get('admin_staff', lookup['id']) if lookup else None
            user = self.public(tx, staff) if staff else None
            return (staff['passwordHash'], user, self.tag(staff)) if user else (self.app.config.password_hash, None, '')
        return self.app.atomic(read, now)

    def resolve(self, value, now):
        if not value:
            return None
        if not value.get('staffId'):
            expected = self.app.digest(self.app.config.password_hash + self.app.config.username)
            return dict(value, user=self.owner()) if hmac.compare_digest(value.get('authTag', ''), expected) else None
        def read(tx):
            staff = tx.get('admin_staff', value['staffId'])
            if not staff or not hmac.compare_digest(value.get('authTag', ''), self.tag(staff)):
                return None
            user = self.public(tx, staff)
            return dict(value, user=user) if user else None
        return self.app.atomic(read, now)

    def require(self, session, permission):
        user = session['user']
        if user['isOwner'] or (permission != 'owner' and permission in user['permissions']):
            return
        fail(403, 'permission_denied', 'Эта функция недоступна для вашей роли.')

    def authorize(self, request, session):
        route = request.path.removeprefix('/api/admin/').split('/')[0]
        read = request.method == 'GET'
        permission = {
            'bookings': 'bookings.read' if read else 'bookings.write',
            'guests': 'profiles.read' if read else 'profiles.write', 'profiles': 'profiles.read',
            'game': 'game.read' if read else 'game.write',
            'game-settings': 'game.read' if read else 'game.write',
            'game-reviews': 'game.read' if read else 'game.write',
            'game-reward': 'profiles.read' if read else 'rewards.redeem',
            'overview': 'analytics.read', 'events': 'analytics.read', 'visitors': 'analytics.read',
            'audit': 'audit.read', 'health': 'owner', 'settings': 'owner', 'purge': 'owner',
            'access': 'owner', 'export': 'data.export',
        }.get(route)
        if route in {'logout', 'smartshell'}:
            return  # Integration routes have their own per-operation permissions.
        self.require(session, permission or 'owner')
        if route == 'export':
            kind = request.query.get('dataset', request.query.get('resource', ''))
            self.require(session, {'bookings':'bookings.read','guests':'profiles.read','audit':'audit.read',
                                   'events':'analytics.read','visitors':'analytics.read'}.get(kind, 'owner'))

    def handle(self, request, session, now):
        self.require(session, 'owner')
        if request.method == 'GET':
            def read(tx):
                staff = [{k: s.get(k) for k in ('id','username','name','roleId','disabled','version','createdAt')}
                         for s in self.app.scan(tx, 'admin_staff')]
                return {'owner': self.owner(), 'permissions': PERMISSIONS,
                        'roles': self.app.scan(tx, 'admin_roles'), 'staff': staff}
            return self.app.atomic(read, now)
        if request.method not in {'POST', 'PATCH'}:
            fail(405, 'method_not_allowed', 'Метод не поддерживается.')
        data = request.body()
        fields(data, {'kind','id','version','username','name','roleId','password','disabled','permissions'})
        kind = data.get('kind')
        if kind not in {'role','staff'}:
            fail(400,'invalid_kind','Выберите сотрудника или роль.')
        new = request.method == 'POST'
        key = str(uuid.uuid4()) if new else text_field(data.get('id',''),'ID',40,True)
        password_hash = None
        if kind == 'staff' and (new or data.get('password')):
            from member import password
            password_hash = make_password_hash(password(data.get('password')))
        def update(tx):
            bucket = 'admin_roles' if kind == 'role' else 'admin_staff'
            old = tx.get(bucket, key)
            if not new:
                if not old: fail(404,'not_found','Запись не найдена.')
                self.app.check_version(data, old)
            if kind == 'role':
                permissions = data.get('permissions', [])
                if not isinstance(permissions,list) or any(not isinstance(p,str) or p not in PERMISSIONS for p in permissions):
                    fail(400,'invalid_permissions','Неизвестные права доступа.')
                # Write permissions always include the corresponding read capability.
                permissions = set(permissions)
                for family in ('bookings','profiles','game'):
                    if family+'.write' in permissions: permissions.add(family+'.read')
                if 'profiles.link' in permissions: permissions.update({'profiles.read','smartshell.clients'})
                if 'rewards.redeem' in permissions: permissions.add('profiles.read')
                item = dict(old or {}, permissions=sorted(permissions))
            else:
                username = text_field(data.get('username',(old or {}).get('username','')),'логин',32,True).lower()
                if not re.fullmatch(r'[a-z0-9_]{4,32}',username) or username.casefold() in {self.app.config.username.casefold(),'admin333'}:
                    fail(400,'invalid_username','Логин занят или недопустим. Владелец не может быть создан как сотрудник.')
                if old and username != old['username']: fail(400,'immutable_username','Логин сотрудника не изменяется.')
                if new and tx.get('admin_names',username): fail(409,'username_taken','Логин уже занят.')
                role_id = data.get('roleId', (old or {}).get('roleId'))
                if not isinstance(role_id,str) or not tx.get('admin_roles',role_id): fail(400,'role_required','Выберите существующую роль.')
                disabled = data.get('disabled',False)
                if not isinstance(disabled,bool): fail(400,'invalid_flag','Некорректное состояние доступа.')
                item = dict(old or {}, username=username, roleId=role_id, disabled=disabled,
                            passwordHash=password_hash or old['passwordHash'], authVersion=(old or {}).get('authVersion',0)+1)
                tx.put('admin_names',username,{'id':key},FOREVER)
            item.update(id=key, name=text_field(data.get('name',''),'название',80,True),
                        version=(old or {}).get('version',0)+1, createdAt=(old or {}).get('createdAt',stamp(now)))
            tx.put(bucket,key,item,FOREVER)
            self.app.audit(tx,now,'access.'+kind+('.create' if new else '.update'),bucket,key,
                           {'name':item['name'],'permissions':item.get('permissions'), 'disabled':item.get('disabled')})
            return {'ok':True,'id':key}
        return self.app.atomic(update,now)
