import assert from 'node:assert/strict';
import { PHONE,VR_MODEL,TARIFFS,DURATIONS,VR_PRICES,defaultDraft,validDraft,parseSavedDraft,quoteDraft,isDate,localDate,dateError,timeChoices,cleanAlias,shareDraft,parseDraftHash,draftText,buildDraftICS } from '../public/club-data.js';

const now=new Date('2026-09-19T12:00:00Z'); // 17:00 Orenburg.
const draft=(patch={})=>({...defaultDraft(),...patch});
const standard={30:400,60:700,90:900,120:1200,180:1600};
const premium={30:500,60:800,90:1200,120:1500,180:2100};
assert.equal(PHONE,'+79510308856');
assert.equal(VR_MODEL,'Meta Quest 2');
assert.deepEqual(TARIFFS.standard.prices,standard);
assert.deepEqual(TARIFFS.pro.prices,premium);
assert.deepEqual(TARIFFS.vip.prices,premium);
assert.deepEqual([TARIFFS.standard.pass5,TARIFFS.standard.pass10,TARIFFS.pro.pass5,TARIFFS.pro.pass10,TARIFFS.vip.pass5,TARIFFS.vip.pass10],[2700,5000,3300,5800,3300,5800]);
assert.deepEqual(VR_PRICES,{30:300,60:400,120:800});
let combinations=0;
for(const tariff of ['standard','pro','vip'])for(const duration of DURATIONS)for(let people=1;people<=7;people++)for(let vrCount=0;vrCount<=people;vrCount++){
  const s=draft({tariff,duration,people,vrCount}),q=quoteDraft(s);
  const base=(tariff==='standard'?standard:premium)[duration],vr=({30:300,60:400,120:800})[duration];
  assert.equal(q.baseTotal,base*people);assert.equal(q.vrTotal,vr*vrCount);assert.equal(q.total,base*people+vr*vrCount);
  combinations++;
}
assert.equal(quoteDraft(draft({tariff:'pro',people:7,vrCount:7})).total,8400,'seven VR guests are allowed');
assert.equal(quoteDraft(draft({people:7,vrCount:3})).total,6100,'mixed VR + monitors only bills three add-ons');
assert.match(draftText(draft({duration:120,vrCount:1})),/2 × 400/,'two-hour VR is explicitly a calculation');
assert.doesNotMatch(draftText(draft({duration:120,vrCount:0})),/2 × 400/);

const badValues=[null,[],{},'draft',false,{},draft({version:2}),draft({status:'confirmed'}),draft({status:'booked'}),draft({tariff:'toString'}),draft({duration:90}),draft({people:0}),draft({people:8}),draft({people:'2'}),draft({vrCount:2}),draft({vrCount:-1}),draft({vrCount:0.5}),draft({alias:'<script>'}),draft({alias:'a\nb'}),draft({alias:'a'.repeat(25)}),draft({goal:'winner'}),draft({date:'2026-02-30'}),draft({time:'24:00'}),draft({untrusted:true})];
for(const value of badValues){assert.equal(validDraft(value),false,JSON.stringify(value));assert.equal(parseSavedDraft(JSON.stringify(value)),null);assert.throws(()=>quoteDraft(value),RangeError);}
assert.equal(validDraft(Object.assign(Object.create({version:1}),defaultDraft())),false,'unexpected prototype is not a stored schema');
assert.equal(parseSavedDraft('{broken'),null);assert.equal(parseSavedDraft(' '.repeat(2049)),null);
assert.equal(parseSavedDraft(JSON.stringify({...draft(),['__proto__']:{status:'confirmed'}})),null,'prototype-shaped extra field is rejected');
assert.deepEqual(parseSavedDraft(JSON.stringify(draft({alias:'Анна М.'}))),draft({alias:'Анна М.'}));
assert.equal(cleanAlias('<Анна>\n М.'),'Анна М.');

assert.equal(isDate('2028-02-29'),true);assert.equal(isDate('2026-02-29'),false);assert.equal(isDate('2026-13-01'),false);
assert.equal(localDate(new Date('2026-09-19T20:01:00Z')),'2026-09-20');
assert.equal(dateError(draft(),now),'');
assert.notEqual(dateError(draft({date:'2026-09-20'}),now),'');
assert.notEqual(dateError(draft({time:'18:00'}),now),'');
assert.notEqual(dateError(draft({date:'2026-09-19',time:'17:00'}),now),'');
assert.notEqual(dateError(draft({date:'2026-09-18',time:'23:00'}),now),'');
assert.notEqual(dateError(draft({date:'2028-09-19',time:'18:00'}),now),'');
for(const [time,duration,allowed] of [['14:00',60,true],['13:45',60,false],['23:45',120,true],['00:00',120,true],['00:30',120,false],['01:30',30,true],['01:30',60,false],['02:00',30,false],['17:07',60,false]]){
  assert.equal(dateError(draft({date:'2026-09-20',time,duration}),now)==='',allowed,time+' / '+duration);
}
const times=timeChoices(draft({date:'2026-09-20',duration:120}),now);
assert.ok(times.includes('00:00'));assert.ok(!times.includes('00:15'));assert.ok(times.includes('14:00'));assert.ok(times.includes('23:45'));assert.ok(!times.includes('13:45'));
assert.deepEqual(timeChoices(draft({date:'2026-09-18'}),now),[]);
const todayTimes=timeChoices(draft({date:'2026-09-19'}),now);assert.ok(!todayTimes.includes('17:00'));assert.ok(todayTimes.includes('17:15'));

const original=draft({tariff:'vip',duration:120,people:7,vrCount:3,date:'2026-09-20',time:'23:45',alias:'Секретное имя',goal:'friends'});
const shared=shareDraft(original);
assert.ok(shared.startsWith('#plan?'));assert.doesNotMatch(decodeURIComponent(shared),/Секретное|alias|confirmed/);
assert.deepEqual(parseDraftHash(shared),{...original,alias:''});
for(const bad of [shared+'&alias=pilot',shared+'&v=1',shared.replace('v=1','v=2'),shared.replace('p=7','p=8'),shared.replace('vr=3','vr=8'),shared+'&status=confirmed',shared.replace('m=120','m=Infinity'),'#plan?'+('a'.repeat(401)),'#prices'])assert.equal(parseDraftHash(bad),null,bad);
assert.throws(()=>shareDraft(draft({status:'confirmed'})),RangeError);

const calendar=buildDraftICS(original,now),unfolded=calendar.replace(/\r\n /g,'');
assert.match(unfolded,/STATUS:TENTATIVE\r\n/);assert.doesNotMatch(unfolded,/STATUS:CONFIRMED|METHOD:REQUEST|ATTENDEE|ORGANIZER/);
assert.match(unfolded,/DTSTART:20260920T184500Z/);assert.match(unfolded,/DTEND:20260920T204500Z/);
assert.match(unfolded,/не бронь/);assert.match(unfolded,/Пожелание: Гонка с друзьями/);
for(const line of calendar.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75,'ICS folds at UTF-8 octets');
const escaped=buildDraftICS({...original,alias:'А, Б; В\\Г'},now).replace(/\r\n /g,'');
assert.ok(escaped.includes('А\\, Б\\; В\\\\Г'));
assert.throws(()=>buildDraftICS(draft(),now),RangeError);
assert.throws(()=>buildDraftICS(draft({date:'2026-09-19',time:'16:00'}),now),RangeError);
assert.throws(()=>buildDraftICS({...original,status:'confirmed'},now),RangeError);
assert.throws(()=>buildDraftICS({...original,date:'2026-02-30'},now),RangeError);
console.log(JSON.stringify({ok:true,priceCombinations:combinations,guestsMax:7,sharedAlias:false,calendarStatus:'TENTATIVE',midnightAndPast:'checked',schema:'strict draft v1'}));
