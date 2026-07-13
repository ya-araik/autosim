import type { Metadata } from "next";

import { FaqList } from "@/components/FaqList";
import { JsonLd } from "@/components/JsonLd";
import { LeadButton } from "@/components/LeadButton";
import { breadcrumbJsonLd, faqJsonLd } from "@/lib/seo";
import { business, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "FAQ по автосимуляторам",
  description:
    "Ответы на частые вопросы АвтоСим: игры, рост, компания друзей, тренировка вождения, VR и бронирование.",
  alternates: {
    canonical: "/faq"
  }
};

export default function FaqPage() {
  return (
    <main>
      <JsonLd data={faqJsonLd()} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Главная", url: siteUrl },
          { name: "FAQ", url: `${siteUrl}/faq` }
        ])}
      />
      <section className="page-hero">
        <div className="container page-hero__inner">
          <p className="section-label">FAQ</p>
          <h1>Частые вопросы об АвтоСим</h1>
          <p>
            Собрали главное перед первым визитом: рост, игры, компания,
            тренировка вождения и бронирование.
          </p>
          <div className="button-row">
            <LeadButton
              source="faq"
              modalTitle="Вопрос по бронированию"
              modalContext="FAQ"
              modalDescription="Напишите вопрос или пожелания по визиту. Администратор подскажет формат и время."
              messagePlaceholder="Например: рост 150 см, хотим забронировать VR на час"
            >
              Задать вопрос
            </LeadButton>
            <a className="btn btn-secondary" href={business.phoneHref}>
              Позвонить
            </a>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container narrow">
          <div className="content-block">
            <p>
              На этой странице собраны ответы для первого визита в клуб
              автосимуляторов АвтоСим: как забронировать время, какие есть
              ограничения по росту, какие игры доступны, как проходит заезд
              с друзьями и чем отличаются обычные сессии от мероприятий.
            </p>
          </div>
          <FaqList />
        </div>
      </section>
    </main>
  );
}
