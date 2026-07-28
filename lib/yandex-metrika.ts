export const YANDEX_METRIKA_ID = 111096292;

export type YandexMetrikaGoal = "zayavka" | "messenger_click" | "phone_click";

declare global {
  interface Window {
    ym?: (...args: unknown[]) => void;
  }
}

export function reachYandexMetrikaGoal(goal: YandexMetrikaGoal) {
  window.ym?.(YANDEX_METRIKA_ID, "reachGoal", goal);
}

export function trackYandexMetrikaPageView(url: string, referer: string) {
  window.ym?.(YANDEX_METRIKA_ID, "hit", url, {
    title: document.title,
    referer
  });
}
