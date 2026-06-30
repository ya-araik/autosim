"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { LeadButton } from "@/components/LeadButton";
import { business, navItems } from "@/lib/site";

export function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  const closeMenu = () => setIsOpen(false);

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link aria-label="АвтоСим - на главную" className="brand" href="/">
          Авто<span>Сим</span>
        </Link>
        <nav aria-label="Основная навигация" className="desktop-nav">
          {navItems.map((item) => (
            <Link
              aria-current={pathname === item.href ? "page" : undefined}
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <a className="phone-link" href={business.phoneHref}>
            {business.phone}
          </a>
          <LeadButton
            className="btn btn-primary header-cta"
            modalContext="Шапка сайта"
            modalDescription="Оставьте контакты и удобное время. Администратор поможет забронировать заезд."
            messagePlaceholder="Например: хочу приехать сегодня вечером, нас будет 2 человека"
            source="booking"
          >
            Забронировать
          </LeadButton>
          <button
            aria-expanded={isOpen}
            aria-label="Открыть меню"
            className="menu-toggle"
            onClick={() => setIsOpen(true)}
            type="button"
          >
            <span />
            <span />
          </button>
        </div>
      </div>
      <div className={`mobile-menu ${isOpen ? "is-open" : ""}`} inert={!isOpen}>
        <div className="mobile-menu__panel">
          <div className="mobile-menu__head">
            <Link className="brand" href="/" onClick={closeMenu}>
              Авто<span>Сим</span>
            </Link>
            <button
              aria-label="Закрыть меню"
              className="modal-close"
              onClick={closeMenu}
              type="button"
            >
              <span aria-hidden="true" />
            </button>
          </div>
          <nav aria-label="Мобильная навигация">
            <LeadButton
              className="mobile-menu__link"
              modalContext="Мобильное меню"
              modalDescription="Оставьте контакты и удобное время. Администратор поможет забронировать заезд."
              messagePlaceholder="Например: хочу приехать сегодня вечером, нас будет 2 человека"
              modalTitle="Бронирование"
              source="booking"
              onClick={closeMenu}
            >
              Забронировать
            </LeadButton>
            {navItems.map((item) => (
              <Link
                className="mobile-menu__link"
                href={item.href}
                key={item.href}
                onClick={closeMenu}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <a className="mobile-menu__phone" href={business.phoneHref}>
            {business.phone}
          </a>
        </div>
      </div>
    </header>
  );
}
