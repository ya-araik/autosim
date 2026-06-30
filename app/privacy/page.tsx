import type { Metadata } from "next";

import { JsonLd } from "@/components/JsonLd";
import { breadcrumbJsonLd } from "@/lib/seo";
import { business, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Политика конфиденциальности",
  description:
    "Политика конфиденциальности АвтоСим: обработка контактных данных при обращении и бронировании.",
  alternates: {
    canonical: "/privacy"
  },
  robots: {
    index: true,
    follow: true
  }
};

export default function PrivacyPage() {
  return (
    <main>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Главная", url: siteUrl },
          { name: "Политика конфиденциальности", url: `${siteUrl}/privacy` }
        ])}
      />
      <section className="page-hero">
        <div className="container page-hero__inner">
          <p className="section-label">Документ</p>
          <h1>Политика конфиденциальности</h1>
          <p>
            Этот раздел описывает, как АвтоСим обрабатывает контактные данные,
            которые посетитель оставляет для связи и бронирования.
          </p>
        </div>
      </section>
      <section className="section">
        <div className="container legal">
          <h2>1. Какие данные могут обрабатываться</h2>
          <p>
            При заполнении формы или обращении по телефону могут обрабатываться:
            имя, номер телефона, комментарий к заявке и источник обращения.
          </p>
          <h2>2. Цель обработки</h2>
          <p>
            Данные используются для связи с посетителем, уточнения деталей
            бронирования, ответа на вопросы и организации визита в клуб.
          </p>
          <h2>3. Передача данных</h2>
          <p>
            В первой версии сайта онлайн-отправка заявки не подключена. После
            подключения Telegram-уведомлений данные будут использоваться только
            для обработки обращения администраторами клуба.
          </p>
          <h2>4. Контакты</h2>
          <p>
            По вопросам обработки данных можно обратиться по телефону{" "}
            <a href={business.phoneHref}>{business.phone}</a>. Адрес клуба:{" "}
            {business.address}.
          </p>
        </div>
      </section>
    </main>
  );
}
