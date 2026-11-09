import {initialMemberSession} from './member-session.js?v=21';

const loading = document.getElementById('member-loading');
document.getElementById('member-retry').addEventListener('click', () => location.reload());
// The import and session request run concurrently. Show authentication only
// after the server explicitly identifies a signed-out guest.
import('./member.js?v=20261109').catch(error => {
  document.getElementById('auth-view').hidden = true;
  document.getElementById('member-view').hidden = true;
  loading.hidden = false;
  loading.setAttribute('aria-busy', 'false');
  document.getElementById('member-loading-status').textContent = 'Не удалось загрузить кабинет. Попробуй ещё раз или позвони в клуб.';
  document.getElementById('member-loading-error').hidden = false;
  console.error('Account boot:', error);
});
