// Start the session check before secondary account modules finish downloading.
// Never cache identity in localStorage or infer authentication from a UI hint.
export async function loadMemberSession() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/member/session', {
      credentials: 'same-origin', cache: 'no-store',
      headers: {Accept: 'application/json'}, signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok || typeof data?.authenticated !== 'boolean') {
      throw Error('Не удалось проверить вход. Повтори попытку.');
    }
    return {data};
  } catch (error) {
    return {error: error.name === 'AbortError'
      ? new Error('Сервер отвечает дольше обычного. Повтори попытку.') : error};
  } finally {
    clearTimeout(timer);
  }
}

export const initialMemberSession = loadMemberSession();
