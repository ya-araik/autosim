"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

import { LeadButton } from "@/components/LeadButton";
import { modes } from "@/lib/site";

type Category = {
  id: string;
  label: string;
  slugs: string[] | null;
};

const categories: Category[] = [
  { id: "all", label: "Все", slugs: null },
  { id: "circuit", label: "Гонки", slugs: ["ring", "open-world", "traffic"] },
  { id: "drift-rally", label: "Дрифт и ралли", slugs: ["drift", "rally"] },
  { id: "cargo", label: "Грузоперевозки и бездорожье", slugs: ["truck", "offroad"] },
  { id: "vr", label: "VR", slugs: ["vr"] }
];

function ModeArrow() {
  return (
    <span aria-hidden="true" className="mode-card__arrow">
      <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
        <path
          d="M7 17 17 7M9 7h8v8"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
    </span>
  );
}

export function ModesGrid() {
  const [activeId, setActiveId] = useState("all");

  const filteredModes = useMemo(() => {
    const category = categories.find((item) => item.id === activeId);

    if (!category?.slugs) return modes;

    return modes.filter((mode) => category.slugs?.includes(mode.slug));
  }, [activeId]);

  return (
    <>
      <div aria-label="Категории режимов" className="container mode-filters" role="tablist">
        {categories.map((category) => (
          <button
            aria-pressed={activeId === category.id}
            className={`mode-filter${activeId === category.id ? " is-active" : ""}`}
            key={category.id}
            type="button"
            onClick={() => setActiveId(category.id)}
          >
            {category.label}
          </button>
        ))}
      </div>
      <div className="container mode-grid">
        {filteredModes.map((mode, index) => {
          const media = (
            <div className="mode-card__media">
              <Image
                alt={mode.alt}
                fill
                priority={index < 4}
                sizes="(max-width: 700px) calc(100vw - 28px), (max-width: 1100px) calc(50vw - 28px), 295px"
                src={mode.image}
              />
            </div>
          );
          const footer = (
            <div className="mode-card__footer">
              <h3>{mode.title}</h3>
              <ModeArrow />
            </div>
          );

          if (mode.slug === "vr") {
            return (
              <Link aria-label={`Подробнее о режиме: ${mode.title}`} className="mode-card" href="#vr" key={mode.slug}>
                {media}
                {footer}
              </Link>
            );
          }

          return (
            <LeadButton
              aria-label={`Выбрать режим: ${mode.title}`}
              className="mode-card"
              key={mode.slug}
              modalTitle={`Бронирование режима: ${mode.title}`}
              modalContext={`Режим: ${mode.title}`}
              modalDescription={`Вы выбрали режим «${mode.title}». Оставьте контакты и пожелания по времени, чтобы администратор помог с бронью.`}
              messagePlaceholder={`Например: хочу ${mode.title.toLowerCase()} на 1 час, нас будет 2 человека`}
              source={`mode:${mode.slug}`}
            >
              {media}
              {footer}
            </LeadButton>
          );
        })}
      </div>
    </>
  );
}
