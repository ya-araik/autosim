import {trackApplication} from './yandex-metrika.js';

const form = document.getElementById('callback-form');
if (form) {
  let requestId = crypto.randomUUID();
  let pending = false;
  let submitted = false;
  let payload = null;
  const status = document.getElementById('callback-status');
  const button = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || submitted || !form.reportValidity()) return;
    pending = true;
    button.disabled = true;
    status.textContent = 'Отправляем заявку…';
    // Keep the exact payload and key after a network timeout: retries cannot create duplicates.
    payload ||= {
      requestId, name: form.elements.name.value.trim(), phone: form.elements.phone.value,
      message: form.elements.message.value.trim(), consent: form.elements.consent.checked,
      source: document.getElementById('booking-choice-summary').textContent.trim().slice(0, 600) || 'Главная страница · обратный звонок'
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/leads', {
        method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload), signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok) {
        if ([400, 409, 415, 429].includes(response.status)) { payload = null; requestId = crypto.randomUUID(); }
        throw new Error(result.error?.message || 'Не удалось отправить заявку. Попробуй ещё раз или позвони.');
      }
      submitted = true;
      trackApplication(result.id);
      status.textContent = 'Заявка принята. Администратор свяжется с тобой для согласования заезда.';
      form.querySelectorAll('input,textarea,button').forEach(control => { control.disabled = true; });
      button.textContent = 'Заявка отправлена';
    } catch (error) {
      status.textContent = error.name === 'AbortError' ? 'Ответ задерживается. Нажми «Отправить заявку» ещё раз — повтор не создаст новую заявку.' : error.message;
    } finally {
      clearTimeout(timeout); pending = false; button.disabled = submitted;
    }
  });
}
