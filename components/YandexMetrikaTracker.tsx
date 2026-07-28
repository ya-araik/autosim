"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import {
  reachYandexMetrikaGoal,
  trackYandexMetrikaPageView,
  type YandexMetrikaGoal
} from "@/lib/yandex-metrika";

const messengerHosts = [
  "t.me",
  "telegram.me",
  "wa.me",
  "whatsapp.com",
  "vk.me",
  "m.me",
  "viber.com"
];

function isMessengerLink(link: HTMLAnchorElement) {
  const href = link.getAttribute("href")?.trim() ?? "";

  if (/^(tg|whatsapp|viber):/i.test(href)) return true;

  try {
    const hostname = new URL(link.href).hostname.toLowerCase();

    return messengerHosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
}

function getLinkGoal(link: HTMLAnchorElement): YandexMetrikaGoal | null {
  if (link.href.startsWith("tel:")) return "phone_click";
  if (isMessengerLink(link)) return "messenger_click";

  return null;
}

export function YandexMetrikaTracker() {
  const pathname = usePathname();
  const previousUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const currentUrl = window.location.href;
    const previousUrl = previousUrlRef.current;

    previousUrlRef.current = currentUrl;

    // The initial page view is sent by ym(..., "init", ...).
    if (!previousUrl || previousUrl === currentUrl) return;

    trackYandexMetrikaPageView(currentUrl, previousUrl);
  }, [pathname]);

  useEffect(() => {
    const trackContactClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;

      const link = event.target.closest<HTMLAnchorElement>("a[href]");

      if (!link) return;

      const goal = getLinkGoal(link);

      if (goal) reachYandexMetrikaGoal(goal);
    };

    document.addEventListener("click", trackContactClick, true);

    return () => document.removeEventListener("click", trackContactClick, true);
  }, []);

  return null;
}
