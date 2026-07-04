"use client";

import { useState } from "react";

import { faqItems } from "@/lib/site";

export function FaqList({ limit }: { limit?: number }) {
  const items = typeof limit === "number" ? faqItems.slice(0, limit) : faqItems;
  const [openItems, setOpenItems] = useState(() => new Set<string>());

  const toggleItem = (question: string) => {
    setOpenItems((current) => {
      const next = new Set(current);

      if (next.has(question)) next.delete(question);
      else next.add(question);

      return next;
    });
  };

  return (
    <div className="faq-list">
      {items.map((item, index) => {
        const isOpen = openItems.has(item.question);
        const answerId = `faq-${index}`;

        return (
          <article className={`faq-item ${isOpen ? "is-open" : ""}`} key={item.question}>
            <button
              aria-controls={answerId}
              aria-expanded={isOpen}
              className="faq-question"
              onClick={() => toggleItem(item.question)}
              type="button"
            >
              <span>{item.question}</span>
              <span className="faq-plus" aria-hidden="true" />
            </button>
            <div className="faq-answer" id={answerId}>
              <div className="faq-answer__inner">
                <p>{item.answer}</p>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
