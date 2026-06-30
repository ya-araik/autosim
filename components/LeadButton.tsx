"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { useLead } from "@/components/LeadProvider";

type LeadButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  source: string;
  modalTitle?: string;
  modalDescription?: string;
  modalContext?: string;
  messagePlaceholder?: string;
  children: ReactNode;
};

export function LeadButton({
  source,
  modalTitle,
  modalDescription,
  modalContext,
  messagePlaceholder,
  children,
  className = "btn btn-primary",
  onClick,
  ...props
}: LeadButtonProps) {
  const { openLead } = useLead();

  return (
    <button
      {...props}
      className={className}
      type="button"
      onClick={(event) => {
        onClick?.(event);
        openLead({
          source,
          title: modalTitle,
          description: modalDescription,
          contextLabel: modalContext,
          placeholder: messagePlaceholder
        });
      }}
    >
      {children}
    </button>
  );
}
