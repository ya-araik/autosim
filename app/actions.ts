"use server";

import { createLead } from "@/lib/leads";
import { runLeadReminderCheck, startLeadReminderWorker } from "@/lib/lead-reminder-worker";
import { sendLeadToTelegram } from "@/lib/telegram";

startLeadReminderWorker();

export type LeadActionState = {
  status: "idle" | "error" | "success";
  message: string;
  fields?: {
    name?: string;
    phone?: string;
    message?: string;
    source?: string;
  };
};

const phonePattern = /^[+()\-\s0-9]{10,24}$/;

export async function submitLead(
  _previousState: LeadActionState,
  formData: FormData
): Promise<LeadActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const source = String(formData.get("source") ?? "booking").trim();

  if (name.length < 2) {
    return {
      status: "error",
      message: "Укажите имя, чтобы администратор понял, к кому обращаться.",
      fields: { name, phone, message, source }
    };
  }

  if (!phonePattern.test(phone)) {
    return {
      status: "error",
      message: "Укажите телефон в формате +7 (999) 000-00-00.",
      fields: { name, phone, message, source }
    };
  }

  try {
    await runLeadReminderCheck();

    const lead = await createLead({ name, phone, message, source });
    await sendLeadToTelegram(lead);

    return {
      status: "success",
      message: "Заявка отправлена. Администратор свяжется с вами для подтверждения бронирования.",
      fields: { name: "", phone: "", message: "", source }
    };
  } catch (error) {
    console.error("Lead submit error", error);

    return {
      status: "error",
      message:
        "Не удалось отправить заявку администратору. Позвоните нам или попробуйте еще раз чуть позже.",
      fields: { name, phone, message, source }
    };
  }
}
