"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type MouseEvent, useEffect, useRef, useState } from "react";

import { LeadButton } from "@/components/LeadButton";
import { business, navItems } from "@/lib/site";

export function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const openMenu = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setIsMenuVisible(true);
    setIsClosing(false);
    requestAnimationFrame(() => setIsOpen(true));
  };

  const closeMenu = () => {
    if (!isMenuVisible) return;

    setIsClosing(true);
    setIsOpen(false);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setIsMenuVisible(false);
      setIsClosing(false);
      closeTimer.current = null;
    }, 260);
  };
  const scrollToPageTarget = (targetId: string) => {
    const target = document.getElementById(targetId);

    if (!target) return;

    const headerHeight = document.querySelector<HTMLElement>(".site-header")?.offsetHeight ?? 0;
    const targetTop = target.getBoundingClientRect().top + window.scrollY;
    const offset = headerHeight + 18;

    window.scrollTo({
      top: Math.max(0, targetTop - offset),
      behavior: "smooth"
    });
  };

  const scrollHomeTop = (event: MouseEvent<HTMLAnchorElement>) => {
    if (pathname !== "/") return;

    event.preventDefault();
    event.currentTarget.blur();
    closeMenu();
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  };
  const scrollHomeHash = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (pathname !== "/" || !href.startsWith("/#")) return;

    event.preventDefault();
    event.currentTarget.blur();
    closeMenu();
    scrollToPageTarget(href.slice(2));
  };
  const handleMobileNavClick = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    closeMenu();
    scrollHomeHash(event, href);
  };

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link aria-label="АвтоСим - на главную" className="brand" href="/" onClick={scrollHomeTop}>
          Авто<span>Сим</span>
        </Link>
        <nav aria-label="Основная навигация" className="desktop-nav">
          {navItems.map((item) => (
            <Link
              aria-current={pathname === item.href ? "page" : undefined}
              href={item.href}
              key={item.href}
              onClick={(event) => scrollHomeHash(event, item.href)}
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
            onClick={openMenu}
            type="button"
          >
            <span />
            <span />
          </button>
        </div>
      </div>
      <div
        className={`mobile-menu ${isMenuVisible || isClosing ? "is-visible" : ""} ${isOpen ? "is-open" : ""} ${isClosing ? "is-closing" : ""}`}
        inert={!isOpen}
      >
        <div className="mobile-menu__panel">
          <div className="mobile-menu__head">
            <Link className="brand" href="/" onClick={scrollHomeTop}>
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
                onClick={(event) => handleMobileNavClick(event, item.href)}
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
