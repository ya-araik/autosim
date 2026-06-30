import type { Metadata } from "next";
import Image from "next/image";

import { JsonLd } from "@/components/JsonLd";
import { LeadButton } from "@/components/LeadButton";
import { breadcrumbJsonLd } from "@/lib/seo";
import { business, eventBenefits, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "День рождения и корпоратив в автосимуляторе",
  description:
    "Проведите день рождения, корпоратив или встречу друзей в АвтоСим: гоночные симуляторы, VR, соревнования и помощь администратора.",
  alternates: {
    canonical: "/events"
  }
};

export default function EventsPage() {
  return (
    <main>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Главная", url: siteUrl },
          { name: "Мероприятия", url: `${siteUrl}/events` }
        ])}
      />
      <section className="page-hero page-hero--image">
        <Image
          alt="Мероприятие в клубе автосимуляторов АвтоСим"
          className="hero-bg"
          fill
          priority
          sizes="100vw"
          src="/assets/photos/2.png"
        />
        <div className="hero-shade" />
        <div className="container page-hero__inner">
          <p className="section-label">Мероприятия</p>
          <h1>День рождения или корпоратив в АвтоСим</h1>
          <p>
            Формат для компании, где все участвуют: заезды, соревнование,
            эмоции, фото и помощь администратора.
          </p>
          <div className="button-row">
            <LeadButton
              source="events"
              modalTitle="Заявка на мероприятие"
              modalContext="Мероприятие в АвтоСим"
              modalDescription="Расскажите про дату, количество гостей, возраст участников и желаемый формат. Администратор предложит подходящий сценарий."
              messagePlaceholder="Например: корпоратив 10 человек, пятница после 19:00, хотим соревнование"
            >
              Оставить заявку
            </LeadButton>
            <a className="btn btn-secondary" href={business.phoneHref}>
              Обсудить по телефону
            </a>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container section-head">
          <p className="section-label">Почему работает</p>
          <h2>Гонки быстро собирают компанию вокруг одного события</h2>
        </div>
        <div className="container feature-grid">
          {eventBenefits.map((benefit) => (
            <article className="feature-card" key={benefit.title}>
              <h3>{benefit.title}</h3>
              <p>{benefit.text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="section section-accent">
        <div className="container event-format">
          <div>
            <h2>Что можно организовать</h2>
            <ul className="check-list">
              <li>День рождения для подростков или взрослых.</li>
              <li>Корпоратив с мини-турниром и несколькими дисциплинами.</li>
              <li>Встречу друзей с заездами по сети.</li>
              <li>Первое знакомство с автосимуляторами под присмотром администратора.</li>
            </ul>
          </div>
          <div className="event-panel">
            <h3>Что уточнить в заявке</h3>
            <p>Дата, время, количество гостей, возраст участников и желаемый формат.</p>
            <LeadButton
              className="btn btn-primary btn-wide"
              source="events:details"
              modalTitle="Подобрать формат мероприятия"
              modalContext="Подбор формата мероприятия"
              modalDescription="Расскажите про дату, количество гостей, возраст участников и желаемый формат. Мы подберем длительность и сценарий заездов."
              messagePlaceholder="Например: день рождения 12 человек, 16 лет, суббота вечером, нужен мини-турнир"
            >
              Подобрать формат
            </LeadButton>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container content-block">
          <h2>Мероприятие с гонками, где участвует вся компания</h2>
          <p>
            АвтоСим подходит для дня рождения в Оренбурге, корпоратива, встречи
            друзей или необычного семейного праздника. Гости могут соревноваться
            в кольцевых гонках, пробовать дрифт, ралли, VR-заезды и городские
            режимы, а администратор помогает настроить формат под возраст и
            опыт участников.
          </p>
          <p>
            Для корпоратива можно собрать мини-турнир с заездами по сети,
            таблицей результатов и несколькими дисциплинами. Для дня рождения
            чаще выбирают более динамичный сценарий: короткие заезды, смена
            режимов, фото и понятные правила для новичков.
          </p>
          <p>
            Чтобы подготовить сценарий, в заявке достаточно указать дату, время,
            количество гостей, возраст участников и желаемую атмосферу:
            спокойное знакомство с автосимуляторами, соревнование или насыщенный
            гоночный вечер.
          </p>
        </div>
      </section>
    </main>
  );
}
