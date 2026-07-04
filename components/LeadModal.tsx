"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";

import { submitLead, type LeadActionState } from "@/app/actions";
import { useLead } from "@/components/LeadProvider";
import { business } from "@/lib/site";

const initialState: LeadActionState = {
  status: "idle",
  message: ""
};

const phonePattern = /^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/;

function getPhoneLocalDigits(value: string) {
  const digits = value.replace(/\D/g, "");

  if (!digits) return "";

  if (digits.startsWith("8") || digits.startsWith("7")) {
    return digits.slice(1, 11);
  }

  return digits.slice(0, 10);
}

function formatLocalPhoneDigits(localDigits: string) {
  const digits = localDigits.slice(0, 10);
  let result = "+7";

  if (digits.length > 0) {
    result += ` (${digits.slice(0, 3)}`;
  }

  if (digits.length >= 3) {
    result += ")";
  }

  if (digits.length > 3) {
    result += ` ${digits.slice(3, 6)}`;
  }

  if (digits.length > 6) {
    result += `-${digits.slice(6, 8)}`;
  }

  if (digits.length > 8) {
    result += `-${digits.slice(8, 10)}`;
  }

  return result;
}

function formatPhone(value: string) {
  const trimmed = value.trim();
  const digits = value.replace(/\D/g, "");

  if (trimmed === "+") return "+";
  if (digits === "7" || digits === "8") return "+7";

  const localDigits = getPhoneLocalDigits(value);

  if (!localDigits) return trimmed.startsWith("+") ? "+" : "";

  return formatLocalPhoneDigits(localDigits);
}

function commitPhoneValue(input: HTMLInputElement, value: string, update: (value: string) => void) {
  update(value);
  input.value = value;
  input.focus();
  input.setSelectionRange(value.length, value.length);
}

export function LeadModal() {
  const { isOpen, source, title, description, contextLabel, placeholder, closeLead } = useLead();
  const [state, formAction, pending] = useActionState(submitLead, initialState);
  const [isClosing, setIsClosing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFormValid = name.trim().length >= 1 && phonePattern.test(phone);

  const closeWithAnimation = useCallback(() => {
    if (isClosing) return;

    setIsClosing(true);
    closeTimerRef.current = setTimeout(() => {
      closeLead();
    }, 180);
  }, [closeLead, isClosing]);

  useEffect(() => {
    document.body.classList.toggle("modal-lock", isOpen);

    return () => document.body.classList.remove("modal-lock");
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) setIsClosing(false);
  }, [isOpen]);

  useEffect(() => {
    if (!state.fields) return;

    setName(state.fields.name ?? "");
    setPhone(formatPhone(state.fields.phone ?? ""));
    setMessage(state.fields.message ?? "");
  }, [state.fields]);

  useEffect(() => {
    const input = phoneInputRef.current;

    if (!input) return;

    input.value = phone;

    if (document.activeElement === input) {
      input.setSelectionRange(phone.length, phone.length);
    }
  }, [phone]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeWithAnimation();
    };

    window.addEventListener("keydown", onKeyDown);
    dialogRef.current?.focus();

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeWithAnimation, isOpen]);

  if (!isOpen) return null;

  return (
    <div className={`modal-backdrop${isClosing ? " is-closing" : ""}`} onMouseDown={closeWithAnimation}>
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
          onClick={closeWithAnimation}
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
              name="name"
              placeholder="Иван Иванов"
              required
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Телефон
            <input
              autoComplete="tel"
              inputMode="numeric"
              maxLength={18}
              name="phone"
              pattern="\+7 \([0-9]{3}\) [0-9]{3}-[0-9]{2}-[0-9]{2}"
              placeholder="+7 (999) 000-00-00"
              ref={phoneInputRef}
              required
              type="tel"
              defaultValue={phone}
              onKeyDown={(event) => {
                if (event.key !== "Backspace") return;

                event.preventDefault();

                const input = event.currentTarget;

                if (input.selectionStart !== input.selectionEnd) {
                  commitPhoneValue(input, formatPhone(
                    `${input.value.slice(0, input.selectionStart ?? 0)}${input.value.slice(input.selectionEnd ?? 0)}`
                  ), setPhone);
                  return;
                }

                const localDigits = getPhoneLocalDigits(input.value);
                commitPhoneValue(input, localDigits ? formatLocalPhoneDigits(localDigits.slice(0, -1)) : "", setPhone);
              }}
              onInput={(event) => {
                commitPhoneValue(event.currentTarget, formatPhone(event.currentTarget.value), setPhone);
              }}
              onPaste={(event) => {
                event.preventDefault();
                commitPhoneValue(event.currentTarget, formatPhone(event.clipboardData.getData("text")), setPhone);
              }}
            />
          </label>
          <label>
            Пожелания
            <textarea
              name="message"
              placeholder={placeholder}
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
          <button className="btn btn-primary btn-wide" disabled={pending || !isFormValid} type="submit">
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
