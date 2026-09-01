"use client";

import { LeadButton } from "@/components/LeadButton";
import { business } from "@/lib/site";

export function MobileStickyCta() {
  return (
    <div className="mobile-sticky-cta">
      <a className="btn btn-secondary" href={business.phoneHref}>
        Позвонить
      </a>
      <LeadButton
        className="btn btn-primary"
        modalContext="Мобильная панель"
        modalDescription="Оставьте контакты и удобное время. Администратор поможет забронировать заезд."
        messagePlaceholder="Например: хочу приехать сегодня вечером, нас будет 2 человека"
        source="mobile-sticky"
      >
        Забронировать
      </LeadButton>
    </div>
  );
}
