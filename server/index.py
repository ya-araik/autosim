"""Yandex Cloud Functions entrypoint. Package the contents of server/ at ZIP root."""
import json
import threading
import os

from app import Application, Config
from storage import YdbStore

_application = None
_lock = threading.Lock()


def source_authorizer(event, context):
    """Separate private function tag used only by the archive gateway route."""
    try:
        config = Config.from_env()
        app = Application(config, YdbStore(config.ydb_endpoint, config.ydb_database))
        return app.source_release.authorize(event, int(app.clock()))
    except Exception:
        return {'isAuthorized': False}


def handler(event, context):
    global _application
    try:
        if _application is None:
            with _lock:
                if _application is None:
                    config = Config.from_env()
                    _application = Application(config, YdbStore(config.ydb_endpoint, config.ydb_database))
        # Timer events arrive directly through the private function IAM binding.
        # HTTP requests, including a forged JSON body, cannot enter this branch.
        if isinstance(event,dict) and 'httpMethod' not in event and 'requestContext' not in event and 'messages' in event:
            expected=os.environ.get('SS_TIMER_TRIGGER_ID','')
            messages=event.get('messages')
            if not expected or not isinstance(messages,list) or len(messages)!=1:
                return {'statusCode':403}
            message=messages[0];meta=message.get('event_metadata',{});details=message.get('details',{})
            if (meta.get('event_type')!='yandex.cloud.events.serverless.triggers.TimerMessage' or
                meta.get('folder_id')!='b1go6svrjnv2ck20p7um' or details.get('trigger_id')!=expected):
                return {'statusCode':403}
            _application.smartshell.sync.tick(int(_application.clock()))
            return {'statusCode':200}
        return _application.handle(event, context)
    except Exception:
        # Deliberately never log event/body, credentials, contacts or SDK diagnostics.
        return {"statusCode": 503, "headers": {
            "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"},
            "body": json.dumps({"error": {"code": "service_unavailable",
                "message": "Сервис временно недоступен. Повторите позже."}}, ensure_ascii=False)}
