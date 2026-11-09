import {JSDOM} from 'jsdom';
import assert from 'node:assert/strict';
import {formatPhone, maskPhone} from '../public/phone-mask.js';
for (const value of ['89991234567','+7 (999) 123-45-67','9991234567']) assert.equal(formatPhone(value),'+7 (999) 123-45-67');
assert.equal(formatPhone(''), '');assert.equal(formatPhone('abc'),'');
assert.equal(formatPhone('89991234567123'),'+7 (999) 123-45-67');
const dom=new JSDOM('<input type="tel">');const input=dom.window.document.querySelector('input');maskPhone(input);
function enter(value,position=value.length){input.value=value;input.setSelectionRange(position,position);input.dispatchEvent(new dom.window.Event('input'));}
enter('89991234567');assert.equal(input.value,'+7 (999) 123-45-67');
input.setSelectionRange(13,13);input.dispatchEvent(new dom.window.InputEvent('beforeinput',{inputType:'deleteContentBackward',cancelable:true}));assert.equal(input.value,'+7 (999) 124-56-7','backspace at separator deletes preceding digit');
enter('+7 (999) 123-45-67',10);assert.equal(input.selectionStart,10,'middle edits preserve cursor');
enter('');assert.equal(input.value,'');
console.log('PASS phone mask: paste, normalization, deletion and caret');
