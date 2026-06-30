import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { FaqList } from "@/components/FaqList";
import { JsonLd } from "@/components/JsonLd";
import { LeadButton } from "@/components/LeadButton";
import { PriceCards } from "@/components/PriceCards";
import { breadcrumbJsonLd } from "@/lib/seo";
import {
  absoluteUrl,
  business,
  eventBenefits,
  externalLinks,
  features,
  galleryImages,
  modes,
  reviews,
  siteUrl
} from "@/lib/site";

export const metadata: Metadata = {
  title: "Клуб автосимуляторов в Оренбурге",
  description:
    "АвтоСим - первый клуб автосимуляторов в Оренбурге: гонки, дрифт, ралли, VR, игры с друзьями, дни рождения и корпоративы.",
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
          <h1>Первый клуб автосимуляторов в Оренбурге</h1>
          <p>
            Погрузись в атмосферу кольцевых гонок, дрифта, ралли, VR,
            дальнобойщиков и заездов по бездорожью.
          </p>
          <div className="button-row">
            <LeadButton
              modalContext="Главная страница"
              modalDescription="Оставьте контакты и удобное время для заезда. Администратор поможет выбрать симулятор и длительность."
              messagePlaceholder="Например: хочу забронировать заезд на двоих сегодня после 20:00"
              source="booking"
            >
              Забронировать заезд
            </LeadButton>
            <a className="btn btn-secondary" href={business.phoneHref}>
              Позвонить
            </a>
          </div>
          <Link className="hero-price-link" href="/prices">
            Смотреть цены и абонементы
          </Link>
        </div>
      </section>

      <section className="section" id="about">
        <div className="container section-head">
          <p className="section-label">О клубе</p>
          <h2>Мы собрали лучшее из мира гонок</h2>
          <p>
            У нас десятки режимов, легендарные трассы и актуальные симуляторы -
            от первого заезда до тренировок на результат.
          </p>
        </div>
        <div className="container feature-grid">
          {features.map((feature) => (
            <article className="feature-card" key={feature.number}>
              <span>{feature.number}</span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section split-section">
        <div className="container split-grid">
          <div>
            <p className="section-label">Автосимулятор - это</p>
            <h2>Реальный опыт вождения без риска для дороги</h2>
            <p>
              Кроме компьютера и монитора, симуляторы оснащены спортивными
              сидениями, педалями, рулем с обратной связью, ручным тормозом и
              настройками под разные дисциплины.
            </p>
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
              src="/assets/optimized/sim_rig.webp"
            />
          </div>
        </div>
      </section>

      <section className="section" id="modes">
        <div className="container section-head section-head--wide">
          <p className="section-label">Режимы</p>
          <h2>Выбирай свой формат заезда</h2>
          <p>
            От спокойной поездки по городу до VR-кокпита и соревновательных
            гонок. Каждый режим можно указать в заявке.
          </p>
        </div>
        <div className="container mode-grid">
          {modes.map((mode) => (
            <article className="mode-card" key={mode.slug}>
              <Image
                alt={mode.alt}
                fill
                sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 25vw"
                src={mode.image}
              />
              <div className="mode-card__content">
                <h3>{mode.title}</h3>
                <p>{mode.description}</p>
                <LeadButton
                  className="btn btn-ghost"
                  modalTitle={`Бронирование режима: ${mode.title}`}
                  modalContext={`Режим: ${mode.title}`}
                  modalDescription={`Вы выбрали режим «${mode.title}». Оставьте контакты и пожелания по времени, чтобы администратор помог с бронью.`}
                  messagePlaceholder={`Например: хочу ${mode.title.toLowerCase()} на 1 час, нас будет 2 человека`}
                  source={`mode:${mode.slug}`}
                >
                  Выбрать
                </LeadButton>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section" id="gallery">
        <div className="container section-head">
          <p className="section-label">Галерея</p>
          <h2>Атмосфера клуба</h2>
        </div>
        <div className="container gallery-grid">
          {galleryImages.map((image) => (
            <div className="gallery-item" key={image.src}>
              <Image alt={image.alt} fill sizes="(max-width: 900px) 100vw, 50vw" src={image.src} />
            </div>
          ))}
        </div>
      </section>

      <section className="section section-accent" id="prices">
        <div className="container section-head">
          <p className="section-label">Цены</p>
          <h2>Цены и абонементы</h2>
          <p>
            На главной - коротко по всем форматам. Полная сетка с длительностью
            заездов и абонементами доступна на отдельной странице.
          </p>
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
              alt="Гости клуба АвтоСим на мероприятии"
              fill
              sizes="(max-width: 900px) 100vw, 48vw"
              src="/assets/photos/1.png"
            />
          </div>
          <div>
            <p className="section-label">Мероприятия</p>
            <h2>День рождения или корпоратив в АвтоСим</h2>
            <p>
              Необычный формат для компании: адреналин, соревнование, помощь
              администратора и сценарии под разный возраст.
            </p>
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
            <div className="review-list">
              {reviews.map((review) => (
                <a
                  className="review-card"
                  href={review.source === "Яндекс Карты" ? business.mapUrl : business.twoGisUrl}
                  key={review.source}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <strong>{review.rating}</strong>
                  <span>★★★★★</span>
                  <h3>{review.source}</h3>
                  <p>{review.text}</p>
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section app-section">
        <div className="container app-grid">
          <div>
            <p className="section-label">Приложение</p>
            <h2>Бронируй и следи за бонусной программой в SmartGamer</h2>
            <p>
              Скачайте приложение, чтобы быстрее бронировать визиты и следить за
              статусом в программе лояльности. Без промокодов и скрытых условий.
            </p>
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

      <section className="section contacts-band">
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
