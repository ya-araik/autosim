"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState
} from "react";

type LeadContextValue = {
  isOpen: boolean;
  source: string;
  title: string;
  description: string;
  contextLabel: string;
  placeholder: string;
  openLead: (options: LeadOpenOptions) => void;
  closeLead: () => void;
};

export type LeadOpenOptions = {
  source: string;
  title?: string;
  description?: string;
  contextLabel?: string;
  placeholder?: string;
};

const LeadContext = createContext<LeadContextValue | null>(null);

const defaultDescription =
  "Оставьте имя и телефон. В первой версии онлайн-отправка не подключена, поэтому после проверки формы мы покажем честную подсказку для связи.";

const defaultPlaceholder = "Например: хочу поиграть в Assetto Corsa вдвоем";

export function LeadProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [source, setSource] = useState("booking");
  const [title, setTitle] = useState("Бронирование");
  const [description, setDescription] = useState(defaultDescription);
  const [contextLabel, setContextLabel] = useState("Общая заявка");
  const [placeholder, setPlaceholder] = useState(defaultPlaceholder);

  const openLead = useCallback((options: LeadOpenOptions) => {
    setSource(options.source);
    setTitle(options.title ?? "Бронирование");
    setDescription(options.description ?? defaultDescription);
    setContextLabel(options.contextLabel ?? options.title ?? "Общая заявка");
    setPlaceholder(options.placeholder ?? defaultPlaceholder);
    setIsOpen(true);
  }, []);

  const closeLead = useCallback(() => {
    setIsOpen(false);
  }, []);

  const value = useMemo(
    () => ({
      isOpen,
      source,
      title,
      description,
      contextLabel,
      placeholder,
      openLead,
      closeLead
    }),
    [closeLead, contextLabel, description, isOpen, openLead, placeholder, source, title]
  );

  return <LeadContext.Provider value={value}>{children}</LeadContext.Provider>;
}

export function useLead() {
  const context = useContext(LeadContext);

  if (!context) {
    throw new Error("useLead must be used inside LeadProvider");
  }

  return context;
}
