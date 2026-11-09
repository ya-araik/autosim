"""Single background worker for the standalone deployment. No inbound webhook."""
import json,os,re,sys,time,urllib.request,urllib.error
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from wsgi import app

from telegram_client import telegram
from legacy_telegram import forward_legacy_update


def bridge(route,body):
    response=app.handle({'path':'/api/booking-bot/'+route,'httpMethod':'POST','headers':{'content-type':'application/json','x-autosim-booking-secret':app.config.booking_secret},'body':json.dumps(body),'requestContext':{'identity':{'sourceIp':'127.0.0.1'}}})
    value=json.loads(response['body'])
    if response['statusCode']!=200:raise RuntimeError(value.get('error',{}).get('message','Не удалось обработать запись.'))
    return value

def card(value):
    labels={'draft':'ОЖИДАЕТ РЕШЕНИЯ','confirmed':'ПОДТВЕРЖДЕНА','cancelled':'ОТМЕНЕНА','completed':'ЗАВЕРШЕНА'}
    text='\n'.join(['АВТОСИМ · ОНЛАЙН-ЗАПИСЬ',value.get('reference',value['id']),'',labels.get(value['status'],value['status']),
        value['guestName'],value['phone'],value['startsAt'],' · '.join((value.get('seatLabels') or [])),str(value['duration'])+' мин · '+str(value['priceRub'])+' ₽',value.get('allocationMessage',''),(value.get('ownerMessage') or '')])
    def button(title,action):return {'text':title,'callback_data':f"asb:{action}:{value['id']}:{value['version']}"}
    rows=[]
    if value['status']=='draft' and not value.get('proposal'):rows.append([button('Подтвердить','c')])
    if value['status'] in ('draft','confirmed'):
        rows.extend([[button('Другое время','p'),button('Связаться с гостем','t')],[button('Отменить','r')]])
    rows.append([button('Обновить','u'),{'text':'Открыть в админке','url':app.config.origins[0]+'/adminka#booking='+value['id']}])
    return {'text':text,'reply_markup':{'inline_keyboard':rows},'link_preview_options':{'is_disabled':True}}

def deliver(ids):
    job=bridge('lease',{}).get('job')
    if not job:return
    owner=job['card']['ownerId']
    if owner not in ids:raise RuntimeError('Owner mismatch')
    receipt=job.get('cancellationMessageId')
    if job.get('cancellationVersion') and not receipt:
        result=telegram('sendMessage',dict(card(job['card']),chat_id=owner,disable_notification=False))
        receipt=result['message_id']
        bridge('cancel-ack',{'id':job['id'],'ownerId':owner,'cancellationVersion':job['cancellationVersion'],'messageId':receipt})
    result=None
    if job.get('messageId'):
        try:result=telegram('editMessageText',dict(card(job['card']),chat_id=owner,message_id=job['messageId']))
        except RuntimeError:pass
    elif receipt:result={'message_id':receipt}
    if not result:result=telegram('sendMessage',dict(card(job['card']),chat_id=owner))
    bridge('ack',{'id':job['id'],'ownerId':owner,'version':job['version'],'leaseToken':job['leaseToken'],'messageId':result['message_id']})

def update(value,ids):
    callback=value.get('callback_query');message=value.get('message',{})
    actor=(callback or message).get('from',{});owner=str(actor.get('id',''))
    chat=(callback or {}).get('message',message).get('chat',{})
    if actor.get('is_bot') or owner not in ids or chat.get('type')!='private' or str(chat.get('id'))!=owner:return
    if callback:
        match=re.fullmatch(r'asb:([cprtu]):([a-f0-9-]{36}):([1-9]\d{0,7})',callback.get('data',''))
        if not match:return
        action,key,version=match.groups();body={'actorId':owner,'id':key,'version':int(version)}
        telegram('answerCallbackQuery',{'callback_query_id':callback['id']})
        try:
            if action=='p':
                current=bridge('action',dict(body,action='refresh'))['card']
                if current['version']!=int(version) or current['status'] not in ('draft','confirmed'):raise RuntimeError('Карточка изменилась. Нажми «Обновить».')
                prompt=telegram('sendMessage',{'chat_id':owner,'text':'АВТОСИМ · ДРУГОЕ ВРЕМЯ\nОтветь: ГГГГ-ММ-ДД ЧЧ:ММ (Оренбург). Для отмены: отмена.','reply_markup':{'force_reply':True}})
                bridge('prompt',dict(body,promptId=prompt['message_id']))
            else:
                current=bridge('action',dict(body,action={'c':'confirm','r':'reject','t':'contact','u':'refresh'}[action]))['card']
                telegram('editMessageText',dict(card(current),chat_id=owner,message_id=callback['message']['message_id']))
        except RuntimeError as error:telegram('sendMessage',{'chat_id':owner,'text':str(error)[:1000]})
    elif message.get('text')=='/start':telegram('sendMessage',{'chat_id':owner,'text':'АВТОСИМ · уведомления владельца подключены.'})
    elif message.get('reply_to_message',{}).get('text','').startswith('АВТОСИМ · ДРУГОЕ ВРЕМЯ'):
        try:
            result=bridge('reply',{'actorId':owner,'promptId':message['reply_to_message']['message_id'],'text':message.get('text','')})
            text='Предложение отменено.' if result.get('cancelled') else 'Предложение отправлено гостю.' if result.get('handled') else 'Запрос уже закрыт.'
        except RuntimeError as error:text=str(error)
        telegram('sendMessage',{'chat_id':owner,'text':text[:1000]})

def run():
    ids=[x.strip() for x in os.environ.get('TELEGRAM_OWNER_IDS','').split(',') if x.strip()]
    mode=os.environ.get('TELEGRAM_UPDATE_MODE','polling')
    enabled=bool(os.environ.get('TELEGRAM_BOT_TOKEN')) and mode!='disabled'
    bookings_enabled=bool(app.config.booking_owner_id and ids)
    if enabled and bookings_enabled and (not 1<=len(ids)<=2 or app.config.booking_owner_id not in ids or any(not re.fullmatch(r'[1-9]\d{4,19}',x) for x in ids)):
        raise SystemExit('Set valid BOOKING_OWNER_ID and TELEGRAM_OWNER_IDS before starting the bot.')
    if mode not in ('disabled','polling','outbound','webhook'):
        raise SystemExit('TELEGRAM_UPDATE_MODE must be disabled, polling, webhook or outbound.')
    if enabled:
        telegram('getMe',{})
        if mode=='polling' and telegram('getWebhookInfo',{}).get('url'):
            raise SystemExit('This bot has an active webhook. Keep the existing service running; plan its cutover before enabling polling here.')
    print('Telegram worker ready: '+mode,flush=True)
    offset=(app.atomic(lambda tx:tx.get('worker','telegram'),int(time.time())) or {}).get('offset',0)
    def handle_update(item):
        from app import ApiError
        try:
            handled=app.leads.update(item,telegram,int(time.time()))
            if not handled and bookings_enabled and str((item.get('callback_query') or {}).get('data', '')).startswith('asb:'):
                update(item,ids);handled=True
            forward_legacy_update(item,handled)
        except ApiError:pass
    next_sync=0
    while True:
        try:
            now=int(time.time())
            if now>=next_sync:
                app.smartshell.sync.tick(now);app.atomic(lambda tx:tx.purge(),now);next_sync=now+60
                if enabled:app.leads.maintenance(telegram,now)
            if enabled:
                for _ in range(5):app.leads.deliver(telegram,now)
                if bookings_enabled:
                    bridge('owners',{'ownerIds':ids})
                    for _ in range(2):deliver(ids)
                if mode=='polling':
                    for item in telegram('getUpdates',{'offset':offset,'timeout':10,'allowed_updates':['message','callback_query']}):
                        handle_update(item)
                        offset=item['update_id']+1
                        app.atomic(lambda tx:tx.put('worker','telegram',{'offset':offset},9999999999),int(time.time()))
                elif mode=='webhook':
                    for _ in range(20):
                        if not app.leads.process_webhooks(handle_update,int(time.time())):break
                    time.sleep(2)
                else:time.sleep(5)
            else:time.sleep(10)
        except Exception:
            print('Background task failed; retrying. Check configuration and service availability.',flush=True);time.sleep(5)

if __name__=='__main__':run()
