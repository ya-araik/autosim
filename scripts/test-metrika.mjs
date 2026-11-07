import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const source=(await readFile('public/yandex-metrika.js','utf8')).replaceAll('export ', '') + '\nwindow.testMetrika={setMetrikaConsent,trackApplication};';
function setup(url){
  const dom=new JSDOM('<a id="phone" href="tel:+79000000000">Call</a><a id="chat" href="https://t.me/fixture">Chat</a>',{url,runScripts:'outside-only'});
  const calls=[];dom.window.ym=(...args)=>calls.push(args);dom.window.eval(source);
  return {dom,calls,api:dom.window.testMetrika};
}
const {dom,calls,api}=setup('https://fixture.example/');
assert.equal(calls.length,0);
api.setMetrikaConsent(true);api.setMetrikaConsent(true);
assert.equal(calls.filter(c=>c[1]==='init').length,1);
assert.equal(calls[0][0],111096292);
assert.equal(calls[0][2].webvisor,true);
api.trackApplication('fixture-request');api.trackApplication('fixture-request');
dom.window.document.getElementById('phone').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));
dom.window.document.getElementById('chat').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));
assert.deepEqual(calls.filter(c=>c[1]==='reachGoal').map(c=>c[2]),['zayavka','phone_click','messenger_click']);
api.setMetrikaConsent(false);const length=calls.length;api.trackApplication('another-request');assert.equal(calls.length,length);
assert.equal(calls.at(-1)[1],'destruct');
for(const url of ['https://localhost:4178/','https://fixture.example:8443/','https://fixture.example/adminka','https://fixture.example/source']){
  const test=setup(url);test.api.setMetrikaConsent(true);test.api.trackApplication('fixture');assert.equal(test.calls.length,0);test.dom.window.close();
}
const cabinet=setup('https://fixture.example/cabinet');cabinet.api.setMetrikaConsent(true);assert.equal(cabinet.calls[0][2].webvisor,false);
cabinet.dom.window.close();dom.window.close();
console.log('Metrika: existing counter, consent, goals, deduplication, private pages and localhost verified.');
