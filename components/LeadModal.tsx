"use client";

import { useActionState, useEffect, useRef } from "react";

import { submitLead, type LeadActionState } from "@/app/actions";
import { useLead } from "@/components/LeadProvider";
import { business } from "@/lib/site";

const initialState: LeadActionState = {
  status: "idle",
  message: ""
};

export function LeadModal() {
  const { isOpen, source, title, description, contextLabel, placeholder, closeLead } = useLead();
  const [state, formAction, pending] = useActionState(submitLead, initialState);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.classList.toggle("modal-lock", isOpen);

    return () => document.body.classList.remove("modal-lock");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeLead();
    };

    window.addEventListener("keydown", onKeyDown);
    dialogRef.current?.focus();

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeLead, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onMouseDown={closeLead}>
      <div
        aria-modal="true"
        className="lead-modal"
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <button
          aria-label="Закрыть форму"
          className="modal-close"
          onClick={closeLead}
          type="button"
        >
          <span aria-hidden="true" />
        </button>
        <div className="modal-copy">
          <p className="section-label">Заявка</p>
          <h2>{title}</h2>
          <p className="modal-context">{contextLabel}</p>
          <p>{description}</p>
        </div>
        <form action={formAction} className="lead-form">
          <input name="source" type="hidden" value={source} />
          <label>
            Ваше имя
            <input
              autoComplete="name"
              defaultValue={state.fields?.name}
              name="name"
              placeholder="Иван Иванов"
              required
              type="text"
            />
          </label>
          <label>
            Телефон
            <input
              autoComplete="tel"
              defaultValue={state.fields?.phone}
              inputMode="tel"
              name="phone"
              placeholder="+7 (999) 000-00-00"
              required
              type="tel"
            />
          </label>
          <label>
            Пожелания
            <textarea
              defaultValue={state.fields?.message}
              name="message"
              placeholder={placeholder}
              rows={4}
            />
          </label>
          <button className="btn btn-primary btn-wide" disabled={pending} type="submit">
            {pending ? "Проверяем..." : "Отправить заявку"}
          </button>
          <p className={`form-message form-message--${state.status}`}>
            {state.message ||
              `Телефон для бронирования сейчас: ${business.phone}. Заявка уйдет администратору после отправки формы.`}
          </p>
        </form>
      </div>
    </div>
  );
}
