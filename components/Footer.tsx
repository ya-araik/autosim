import Link from "next/link";

import { LeadButton } from "@/components/LeadButton";
import { business, externalLinks, navItems } from "@/lib/site";

export function Footer() {
  return (
    <footer className="footer" id="footer">
      <div className="container footer-grid">
        <div>
          <Link className="brand footer-brand" href="/">
            Авто<span>Сим</span>
          </Link>
          <p>
            Клуб автосимуляторов в Оренбурге: гонки, VR, компания друзей,
            дни рождения и корпоративы.
          </p>
          <div className="button-row">
            <LeadButton
              modalContext="Контакты"
              modalDescription="Оставьте контакты и удобное время для связи. Администратор поможет с маршрутом и бронью."
              messagePlaceholder="Например: хочу уточнить свободное время на сегодня после 19:00"
              source="contacts"
            >
              Оставить заявку
            </LeadButton>
            <a className="btn btn-secondary" href={business.phoneHref}>
              Позвонить
            </a>
          </div>
        </div>
        <div>
          <h2>Навигация</h2>
          <ul className="footer-list">
            {navItems.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
            <li>
              <Link href="/privacy">Политика конфиденциальности</Link>
            </li>
          </ul>
        </div>
        <div>
          <h2>Контакты</h2>
          <ul className="footer-list">
            <li>{business.address}</li>
            <li>{business.openingHours}</li>
            <li>
              <a href={business.phoneHref}>{business.phone}</a>
            </li>
            <li>
              <a href={business.mapUrl} rel="noopener noreferrer" target="_blank">
                Построить маршрут
              </a>
            </li>
          </ul>
        </div>
        <div>
          <h2>Соцсети</h2>
          <ul className="footer-list">
            <li>
              <a href={externalLinks.instagram} rel="noopener noreferrer" target="_blank">
                Instagram
              </a>
            </li>
            <li>
              <a href={externalLinks.vk} rel="noopener noreferrer" target="_blank">
                ВКонтакте
              </a>
            </li>
            <li>
              <a href={externalLinks.telegram} rel="noopener noreferrer" target="_blank">
                Telegram
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>© 2026 АвтоСим. Все права защищены.</span>
      </div>
    </footer>
  );
}
