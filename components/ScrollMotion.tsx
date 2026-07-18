"use client";

import { useEffect } from "react";

const motionSelector = [
  ".section-head",
  ".split-grid > *",
  ".feature-card",
  ".vr-actions",
  ".mode-card",
  ".gallery-item",
  ".price-card",
  ".price-summary-card",
  ".benefit-list article",
  ".reviews-grid > div",
  ".app-grid > *",
  ".contacts-grid > *",
  ".choice-grid article",
  ".event-panel",
  ".media-frame",
  ".rig-showcase",
  ".phone-shot"
].join(",");

export function ScrollMotion() {
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const elements = Array.from(document.querySelectorAll<HTMLElement>(motionSelector));

    if (prefersReducedMotion) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }

    document.documentElement.classList.add("motion-ready");

    elements.forEach((element, index) => {
      element.dataset.motion = "reveal";
      element.style.setProperty("--motion-order", String(index % 6));
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      {
        rootMargin: "0px 0px -8% 0px",
        threshold: 0.14
      }
    );

    elements.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
      document.documentElement.classList.remove("motion-ready");
    };
  }, []);

  return null;
}
