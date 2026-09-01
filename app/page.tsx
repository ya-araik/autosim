import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { FaqList } from "@/components/FaqList";
import { Gallery } from "@/components/Gallery";
import { JsonLd } from "@/components/JsonLd";
import { LeadButton } from "@/components/LeadButton";
import { ModesGrid } from "@/components/ModesGrid";
import { PriceCards } from "@/components/PriceCards";
import { breadcrumbJsonLd } from "@/lib/seo";
import {
  absoluteUrl,
  business,
  eventBenefits,
  externalLinks,
  features,
  reviews,
  siteUrl
} from "@/lib/site";

export const metadata: Metadata = {
  title: "Клуб автосимуляторов в Оренбурге",
  description:
    "АвтоСим - первый клуб автосимуляторов в Оренбурге: гонки, дрифт, ралли, совместные VR-заезды с друзьями, дни рождения и корпоративы.",
  alternates: {
    canonical: "/"
  }
};

export default function HomePage() {
  return (
    <main>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Главная", url: siteUrl }
        ])}
      />

      <section className="hero">
        <Image
          alt="Автосимуляторы в клубе АвтоСим"
          className="hero-bg"
          fill
          priority
          sizes="100vw"
          src="/assets/photos/3.png"
        />
        <div className="hero-shade" />
        <div className="container hero-content">
          <h1>
            <span className="accent">Первый</span> клуб автосимуляторов в Оренбурге
          </h1>
          <p>Гонки, дрифт, ралли, VR и бездорожье — в одном клубе.</p>
          <div className="button-row">
            <LeadButton
              modalContext="Главная страница"
              modalDescription="Оставьте контакты и удобное время для заезда. Администратор поможет выбрать симулятор и длительность."
              messagePlaceholder="Например: хочу забронировать заезд на двоих сегодня после 20:00"
              source="booking"
            >
              Забронировать симулятор
            </LeadButton>
            <a className="btn btn-secondary" href={business.phoneHref}>
              Позвонить
            </a>
          </div>
          <Link className="hero-price-link" href="/prices">
            Смотреть цены и абонементы
          </Link>
          <div className="trust-strip">
            {reviews.map((review) => (
              <a
                className="trust-pill"
                href={review.url}
                key={review.source}
                rel="noopener noreferrer"
                target="_blank"
              >
                <strong>★ {review.rating}</strong> {review.source}
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="section split-section" id="about">
        <div className="container split-grid">
          <div>
            <p className="section-label">О клубе</p>
            <h2>
              Реальный опыт вождения без <span className="accent">риска</span>
            </h2>
            <ul className="about-features">
              {features.map((feature) => (
                <li key={feature.number}>
                  <span>{feature.number}</span>
                  <div>
                    <h3>{feature.title}</h3>
                    <p>{feature.text}</p>
                  </div>
                </li>
              ))}
            </ul>
            <LeadButton
              modalTitle="Первый заезд"
              modalContext="Первый заезд"
              modalDescription="Расскажите, когда хотите приехать и какой формат вам ближе. Администратор поможет подобрать симулятор и длительность."
              messagePlaceholder="Например: первый раз, хочу попробовать спокойный режим на 1 час"
              source="home:about"
            >
              Попробовать
            </LeadButton>
          </div>
          <div className="rig-showcase">
            <Image
              alt="Кокпит автосимулятора АвтоСим"
              fill
              sizes="(max-width: 900px) 100vw, 50vw"
              src="/assets/optimized/sim-rig-cockpit-vignette.webp"
              unoptimized
            />
          </div>
        </div>
      </section>

      <section className="section" id="modes">
        <div className="container section-head section-head--wide">
          <p className="section-label">Режимы</p>
          <h2>Выбирай свой формат заезда</h2>
          <p>От спокойной езды по городу до полного погружения в VR.</p>
        </div>
        <ModesGrid />
      </section>

      <section className="section section-accent vr-section" id="vr">
        <div className="container section-head section-head--wide">
          <p className="section-label">VR для компании</p>
          <h2>
            Совместные заезды <span className="accent">в VR</span>
          </h2>
          <p>До 5 человек в одной гонке — VR-очков хватит на всех.</p>
        </div>
        <div className="container">
          <div className="vr-portrait">
            <Image
              alt="Гостья клуба АвтоСим надевает VR-очки перед заездом"
              fill
              sizes="(max-width: 900px) 100vw, 1180px"
              src="/assets/optimized/vr-portrait.webp"
            />
          </div>
        </div>
        <div className="container feature-grid vr-grid">
          <article className="feature-card vr-card">
            <span>01</span>
            <h3>Одна гонка на всех</h3>
            <p>Общий старт, борьба за позиции — соперники в соседних кокпитах.</p>
          </article>
          <article className="feature-card vr-card">
            <span>02</span>
            <h3>Обзор на 360°</h3>
            <p>Поворот головы как в реальной машине: зеркала, апекс, слепые зоны.</p>
          </article>
          <article className="feature-card vr-card">
            <span>03</span>
            <h3>VR на всю компанию</h3>
            <p>От 300 ₽ за 30 минут — к одному месту или сразу ко всем.</p>
          </article>
          <article className="feature-card vr-card">
            <span>04</span>
            <h3>Подходит новичкам</h3>
            <p>Администратор настроит очки и посадку. Снять и продолжить на мониторе можно в любой момент.</p>
          </article>
        </div>
        <div className="container vr-actions">
          <LeadButton
            modalTitle="VR-заезд для компании"
            modalContext="Совместный заезд в VR"
            modalDescription="Расскажите, когда хотите приехать и сколько будет участников. Для совместного VR-заезда доступно до пяти мест."
            messagePlaceholder="Например: нас 5 человек, хотим общий VR-заезд в субботу после 19:00"
            source="home:vr"
          >
            Забронировать VR-заезд для компании
          </LeadButton>
          <a className="btn btn-secondary" href={business.phoneHref}>
            Позвонить
          </a>
        </div>
      </section>

      <section className="section" id="gallery">
        <div className="container section-head">
          <p className="section-label">Галерея</p>
          <h2>Атмосфера клуба</h2>
        </div>
        <Gallery />
      </section>

      <section className="section section-accent" id="prices">
        <div className="container section-head">
          <p className="section-label">Цены</p>
          <h2>Цены и абонементы</h2>
          <p>Коротко — по форматам. Полная сетка цен на отдельной странице.</p>
          <Link className="btn btn-primary prices-more-link" href="/prices">
            Открыть полные цены
          </Link>
        </div>
        <div className="container">
          <PriceCards compact />
        </div>
      </section>

      <section className="section split-section" id="events">
        <div className="container split-grid split-grid--reverse">
          <div className="media-frame media-frame--tall">
            <Image
              alt="Руль и оборудование автосимулятора АвтоСим"
              fill
              sizes="(max-width: 900px) 100vw, 48vw"
              src="/assets/optimized/events-wheel.webp"
            />
          </div>
          <div>
            <p className="section-label">Мероприятия</p>
            <h2>
              День рождения или <span className="accent">корпоратив</span>
            </h2>
            <p>Адреналин, соревнование и сценарии под любой возраст.</p>
            <div className="benefit-list">
              {eventBenefits.map((benefit) => (
                <article key={benefit.title}>
                  <h3>{benefit.title}</h3>
                  <p>{benefit.text}</p>
                </article>
              ))}
            </div>
            <div className="button-row">
              <LeadButton
                modalTitle="Заявка на мероприятие"
                modalContext="Мероприятие в АвтоСим"
                modalDescription="Расскажите про дату, количество гостей, возраст участников и желаемый формат. Администратор предложит подходящий сценарий."
                messagePlaceholder="Например: корпоратив 10 человек, пятница после 19:00, хотим соревнование"
                source="events"
              >
                Оставить заявку
              </LeadButton>
              <Link className="btn btn-secondary" href="/events">
                Подробнее
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section reviews-section" id="reviews">
        <div className="container reviews-grid">
          <div>
            <p className="section-label">FAQ</p>
            <h2>Частые вопросы</h2>
            <FaqList limit={4} />
            <Link className="inline-link" href="/faq">
              Все вопросы
            </Link>
          </div>
          <div>
            <p className="section-label">Отзывы</p>
            <h2>Что говорят наши пилоты</h2>
            <div className="reviews-widget">
              <iframe loading="lazy" src={business.reviewsWidgetUrl} title="Отзывы АвтоСим на Яндекс Картах" />
              <a href={business.mapUrl} rel="noopener noreferrer" target="_blank">
                АвтоСим на карте Оренбурга - Яндекс Карты
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="section app-section">
        <div className="container app-grid">
          <div>
            <p className="section-label">Приложение</p>
            <h2>Бронируй и следи за бонусами в SmartGamer</h2>
            <p>Быстрая бронь и программа лояльности — без промокодов и скрытых условий.</p>
            <div className="store-links">
              <a href={externalLinks.googlePlay} rel="noopener noreferrer" target="_blank">
                Google Play
              </a>
              <a href={externalLinks.appStore} rel="noopener noreferrer" target="_blank">
                App Store
              </a>
              <a href={externalLinks.ruStore} rel="noopener noreferrer" target="_blank">
                RuStore
              </a>
            </div>
          </div>
          <div className="phone-shot">
            <Image
              alt="Скриншот приложения SmartGamer"
              fill
              sizes="(max-width: 900px) 80vw, 360px"
              src="/assets/optimized/final_banner.webp"
            />
          </div>
        </div>
      </section>

      <section className="section contacts-band" id="contacts">
        <div className="container contacts-grid">
          <div>
            <p className="section-label">Контакты</p>
            <h2>Ждем тебя в нашем боксе</h2>
            <p>{business.address}</p>
            <p>{business.openingHours}</p>
          </div>
          <div className="button-row">
            <a className="btn btn-primary" href={business.mapUrl} rel="noopener noreferrer" target="_blank">
              Построить маршрут
            </a>
            <a className="btn btn-secondary" href={business.phoneHref}>
              {business.phone}
            </a>
          </div>
          <div className="map-frame">
            <iframe
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              src={business.mapWidgetUrl}
              title="АвтоСим на карте Оренбурга"
            />
            <a
              className="map-frame__fallback"
              href={business.mapUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              Открыть карту в Яндексе
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
