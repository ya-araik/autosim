// The club page remains a static poster until an explicit request to drive.
let loadingExperience;
let launching = false;

function getExperience() {
  if (!loadingExperience) {
    loadingExperience = import('./drive-experience.js?v=23')
      .then(module => module.initDrivingExperience())
      .catch(error => {
        loadingExperience = null;
        throw error;
      });
  }
  return loadingExperience;
}

// Delegation supports buttons added after this module as well.
document.addEventListener('click', async event => {
  const button = event.target.closest?.('[data-open-drive]');
  if (!button || launching) return;
  event.preventDefault();
  launching = true;
  button.setAttribute('aria-busy', 'true');
  const status = document.getElementById('drive-launch-status');
  if (status) { status.setAttribute('role', 'status'); status.textContent = 'Загружаем заезд…'; }
  try {
    const api = await getExperience();
    const ready = await api.open(button.dataset.openDrive, button.dataset.driveAssist);
    if (status) status.textContent = ready ? '' : 'Заезд не загрузился. Можно повторить запуск в окне игры.';
  } catch (error) {
    if (status) status.textContent = 'Не удалось загрузить заезд. Нажми «За руль» ещё раз.';
    console.warn('Автосим: test drive could not load.', error);
  } finally {
    launching = false;
    button.removeAttribute('aria-busy');
  }
});
