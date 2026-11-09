// Russian phone numbers: accept pasted +7, 8 or ten national digits.
export function formatPhone(value) {
  let digits = value.replace(/\D/g, '');
  if (/^[78]/.test(digits)) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (!digits) return value.replace(/\D/g, '') ? '+7' : '';
  let result = '+7 (' + digits.slice(0, 3);
  if (digits.length >= 3) result += ')';
  if (digits.length > 3) result += ' ' + digits.slice(3, 6);
  if (digits.length > 6) result += '-' + digits.slice(6, 8);
  if (digits.length > 8) result += '-' + digits.slice(8, 10);
  return result;
}

export function maskPhone(input) {
  function format() {
    const value = input.value, position = input.selectionStart ?? value.length;
    const digitsBefore = value.slice(0, position).replace(/\D/g, '').length;
    const addedPrefix = value.replace(/\D/g, '') && !/^[78]/.test(value.replace(/\D/g, '')) ? 1 : 0;
    const atEnd = position === value.length;
    input.value = formatPhone(value);
    let caret = input.value.length;
    if (!atEnd) {
      let count = 0; caret = 0;
      while (caret < input.value.length && count < digitsBefore + addedPrefix) {
        if (/\d/.test(input.value[caret])) count++;
        caret++;
      }
    }
    input.setSelectionRange(caret, caret);
  }
  input.addEventListener('input', format);
  input.addEventListener('change', format);
  input.addEventListener('beforeinput', event => {
    if (!['deleteContentBackward', 'deleteContentForward'].includes(event.inputType) || input.selectionStart !== input.selectionEnd) return;
    const backward = event.inputType === 'deleteContentBackward';
    const position = input.selectionStart;
    let index = backward ? position - 1 : position;
    if (index < 0 || index >= input.value.length || /\d/.test(input.value[index])) return;
    while (index >= 0 && index < input.value.length && !/\d/.test(input.value[index])) index += backward ? -1 : 1;
    if (index < 0 || index >= input.value.length) return;
    event.preventDefault();
    input.value = input.value.slice(0, index) + input.value.slice(index + 1);
    input.setSelectionRange(index, index);
    format();
  });
  format();
}
