import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {JSDOM} from 'jsdom';
import {TARIFFS} from '../public/club-data.js';

// Previous site's current main (648d3be), including both subscription lengths.
const expected = {
  standard: [400, 700, 900, 1200, 1600, 2700, 5000],
  pro: [500, 800, 1200, 1500, 2100, 3300, 5800],
  vip: [500, 800, 1200, 1500, 2100, 3300, 5800]
};
const durations = [30, 60, 90, 120, 180];
const dom = new JSDOM(readFileSync('public/index.html', 'utf8'));
const rows = [...dom.window.document.querySelectorAll('.all-prices tbody tr')];
assert.equal(rows.length, 7);
for (const [column, name] of ['standard', 'pro', 'vip'].entries()) {
  const tariff = TARIFFS[name];
  assert.deepEqual([...durations.map(n => tariff.prices[n]), tariff.pass5, tariff.pass10], expected[name]);
  assert.deepEqual(rows.map(row => Number(row.querySelectorAll('td')[column].textContent.replace(/\D/g, ''))), expected[name]);
}
assert.match(dom.window.document.querySelector('.hero-v40-price').textContent, /400/);
assert.match(dom.window.document.getElementById('equipment-rate-value').textContent, /700/);
const backend = JSON.parse(execFileSync('python3', ['-c', 'import sys,json;sys.path.insert(0,"server");from app import PRICES;print(json.dumps(PRICES))'], {encoding:'utf8'}));
for (const [name, prices] of Object.entries(backend)) {
  for (const [duration, price] of Object.entries(prices)) assert.equal(price, TARIFFS[name].prices[duration]);
}
dom.window.close();
console.log('Current prices: public table, tariff data, subscription prices and backend agree with the previous site.');
