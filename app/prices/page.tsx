import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd } from "@/components/JsonLd";
import { LeadButton } from "@/components/LeadButton";
import { PriceCards } from "@/components/PriceCards";
import { breadcrumbJsonLd, offerCatalogJsonLd } from "@/lib/seo";
import { business, pricePlans, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Цены на автосимуляторы в Оренбурге",
  description:
    "Стоимость заездов в АвтоСим: Standart, Pro, VIP, VR-очки, абонементы и бронирование игрового времени в Оренбурге.",
  alternates: {
    canonical: "/prices"
  }
};

export default function PricesPage() {
  return (
    <main>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Главная", url: siteUrl },
          { name: "Цены", url: `${siteUrl}/prices` }
        ])}
      />
      <JsonLd data={offerCatalogJsonLd()} />
      <section className="page-hero">
        <div className="container page-hero__inner">
          <p className="section-label">Цены</p>
          <h1>Цены и абонементы АвтоСим</h1>
          <p>
            Выберите формат под задачу: первый заезд, тренировка, игра с друзьями
            или длительный абонемент.
          </p>
          <div className="button-row">
            <LeadButton
              source="prices"
              modalTitle="Бронирование по ценам"
              modalContext="Страница цен"
              modalDescription="Оставьте контакты и напишите, какой тариф или длительность рассматриваете. Администратор уточнит свободное время."
              messagePlaceholder="Например: хочу Pro на 2 часа в выходные, нас будет 3 человека"
            >
              Забронировать
            </LeadButton>
            <a className="btn btn-secondary" href={business.phoneHref}>
              Позвонить
            </a>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container">
          <PriceCards />
        </div>
      </section>
      <section className="section section-accent">
        <div className="container content-block">
          <h2>Как выбрать формат</h2>
          <div className="choice-grid">
            {pricePlans.map((plan) => (
              <article key={plan.title}>
                <h3>{plan.title}</h3>
                <p>
                  {plan.title === "Standart"
                    ? "Подходит для первого знакомства, игры с друзьями и спокойных заездов."
                    : plan.title === "Pro"
                      ? "Выбор для тех, кто хочет больше мощности, широкий монитор и плотную обратную связь."
                      : plan.title === "VIP"
                        ? "Формат с большим экраном 65 дюймов, MOZA R9 и шифтером Simmagic для максимального погружения."
                        : "Добавляет эффект кокпита и особенно хорошо работает для коротких эмоциональных сессий."}
                </p>
              </article>
            ))}
          </div>
          <p>
            Если сомневаетесь, позвоните администратору: подберем длительность и
            формат под количество гостей.
          </p>
          <p>
            Для первого визита обычно достаточно 30-60 минут: этого хватает,
            чтобы привыкнуть к рулю, педалям и выбрать любимую дисциплину. Для
            игры с друзьями, тренировки на результат или нескольких режимов
            удобнее бронировать от 1,5-2 часов.
          </p>
          <p>
            Абонементы подходят тем, кто планирует возвращаться регулярно:
            можно тренировать конкретные трассы, пробовать разные симуляторы и
            распределять часы между спокойными заездами, дрифтом, ралли или VR.
          </p>
          <Link className="inline-link" href="/events">
            Посмотреть варианты для праздника
          </Link>
        </div>
      </section>
    </main>
  );
}
