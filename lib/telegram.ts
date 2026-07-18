import type { WithId } from "mongodb";
import { fetch as undiciFetch, ProxyAgent } from "undici";

import {
  findFailedTelegramLeads,
  formatTelegramUser,
  getLeadById,
  listLeads,
  markTelegramFailed,
  markTelegramSent,
  type LeadDocument
} from "@/lib/leads";
import { getSourceLabel } from "@/lib/source-labels";

export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramChat = {
  id: number;
  type?: string;
  title?: string;
};

export type TelegramMessage = {
  message_id: number;
  chat: TelegramChat;
  text?: string;
  from?: TelegramUser;
  reply_to_message?: TelegramMessage;
};

export type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
};

export type TelegramUpdate = {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  my_chat_member?: {
    chat: TelegramChat;
  };
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type TelegramInlineKeyboardButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };

export type TelegramInlineKeyboard = {
  inline_keyboard: Array<Array<TelegramInlineKeyboardButton>>;
};

let telegramProxyAgent: ProxyAgent | undefined;

function getTelegramProxyAgent() {
  const proxyUrl = process.env.TELEGRAM_PROXY_URL?.trim();

  if (!proxyUrl) return undefined;

  telegramProxyAgent ??= new ProxyAgent(proxyUrl);
  return telegramProxyAgent;
}

function getBotToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  return token;
}

export function getAdminChatId() {
  const chatId = Number(process.env.TELEGRAM_ADMIN_CHAT_ID);

  if (!Number.isFinite(chatId)) {
    throw new Error("TELEGRAM_ADMIN_CHAT_ID is not configured");
  }

  return chatId;
}

export function isAllowedChat(chatId?: number) {
  if (typeof chatId !== "number") return false;
  return chatId === getAdminChatId();
}

export function toTelegramUserRef(user: TelegramUser) {
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();

  return {
    userId: user.id,
    username: user.username,
    displayName: displayName || user.username || String(user.id)
  };
}

async function telegramRequest<T>(
  method: string,
  body: Record<string, unknown>,
  timeoutMs = 10_000
) {
  const response = await undiciFetch(`https://api.telegram.org/bot${getBotToken()}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body),
    cache: "no-store",
    dispatcher: getTelegramProxyAgent(),
    signal: AbortSignal.timeout(timeoutMs)
  });

  const data = (await response.json()) as TelegramApiResponse<T>;

  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram ${method} request failed`);
  }

  return data.result as T;
}

function escapeHtml(value: string | number | undefined | null) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatDate(date?: Date) {
  if (!date) return "-";

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Yekaterinburg"
  }).format(date);
}

function statusLabel(status: LeadDocument["status"]) {
  if (status === "new") return "Новая";
  if (status === "in_progress") return "В работе";
  return "Завершена";
}

function leadKeyboard(lead: WithId<LeadDocument>): TelegramInlineKeyboard | undefined {
  const leadId = lead._id.toString();

  if (lead.status === "new") {
    return {
      inline_keyboard: [[{ text: "Взять в работу", callback_data: `lead:${leadId}:take` }]]
    };
  }

  if (lead.status === "in_progress") {
    const completionButtons = lead.completionCommentRequestedBy
      ? [[{ text: "Завершить без комментария", callback_data: `lead:${leadId}:done` }]]
      : [
          [{ text: "Завершить", callback_data: `lead:${leadId}:done` }],
          [{ text: "Завершить с комментарием", callback_data: `lead:${leadId}:comment` }]
        ];

    return {
      inline_keyboard: [
        ...completionButtons,
        [{ text: "Вернуть в новые", callback_data: `lead:${leadId}:release` }]
      ]
    };
  }

  return undefined;
}

export function formatLeadMessage(lead: WithId<LeadDocument>) {
  const lines = [
    `<b>Заявка #${lead.leadNumber}</b>`,
    "",
    `<b>Источник:</b> ${escapeHtml(getSourceLabel(lead.source))}`,
    `<b>Имя:</b> ${escapeHtml(lead.name)}`,
    `<b>Телефон:</b> <code>${escapeHtml(lead.phone)}</code>`,
    `<b>Пожелания:</b> ${escapeHtml(lead.message || "Не указаны")}`,
    "",
    `<b>Статус:</b> ${statusLabel(lead.status)}`,
    `<b>Создана:</b> ${formatDate(lead.createdAt)}`
  ];

  if (lead.assignedTo) {
    lines.push(`<b>Ответственный:</b> ${escapeHtml(formatTelegramUser(lead.assignedTo))}`);
    lines.push(`<b>Взята:</b> ${formatDate(lead.assignedAt)}`);
  }

  if (lead.completionCommentRequestedBy && lead.completionCommentExpiresAt) {
    lines.push("");
    lines.push(
      `<b>Ожидается комментарий завершения от:</b> ${escapeHtml(
        formatTelegramUser(lead.completionCommentRequestedBy)
      )}`
    );
    lines.push(`<b>Ответьте на это сообщение до:</b> ${formatDate(lead.completionCommentExpiresAt)}`);
    lines.push("Если комментарий не придет в течение часа, заявка завершится без комментария.");
  }

  if (lead.completedBy) {
    lines.push(`<b>Завершил:</b> ${escapeHtml(formatTelegramUser(lead.completedBy))}`);
    lines.push(`<b>Завершена:</b> ${formatDate(lead.completedAt)}`);
  }

  if (lead.completionComment) {
    lines.push(`<b>Комментарий завершения:</b> ${escapeHtml(lead.completionComment)}`);
  }

  return lines.join("\n");
}

export async function sendTelegramMessage(
  chatId: number,
  text: string,
  replyMarkup?: TelegramInlineKeyboard
) {
  return telegramRequest<TelegramMessage>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: replyMarkup
  });
}

export function getTelegramMessageUrl(chatId: number, messageId: number) {
  const chatIdText = String(chatId);

  if (!chatIdText.startsWith("-100")) return null;

  return `https://t.me/c/${chatIdText.slice(4)}/${messageId}`;
}

export async function sendLeadToTelegram(lead: WithId<LeadDocument>) {
  try {
    const message = await sendTelegramMessage(getAdminChatId(), formatLeadMessage(lead), leadKeyboard(lead));
    await markTelegramSent(lead._id, message.chat.id, message.message_id);
    const freshLead = await getLeadById(lead._id.toString());
    return freshLead ?? lead;
  } catch (error) {
    await markTelegramFailed(lead._id, error);
    throw error;
  }
}

export async function editLeadTelegramMessage(lead: WithId<LeadDocument>) {
  if (!lead.telegramChatId || !lead.telegramMessageId) return;

  try {
    await telegramRequest<TelegramMessage>("editMessageText", {
      chat_id: lead.telegramChatId,
      message_id: lead.telegramMessageId,
      text: formatLeadMessage(lead),
      parse_mode: "HTML",
      reply_markup: leadKeyboard(lead)
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("message is not modified")) {
      return;
    }

    throw error;
  }
}

export async function answerCallbackQuery(callbackQueryId: string, text: string, showAlert = false) {
  await telegramRequest<boolean>("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert
  }, 3_000);
}

export async function leaveChat(chatId: number) {
  await telegramRequest<boolean>("leaveChat", {
    chat_id: chatId
  });
}

export async function deleteMessage(chatId: number, messageId: number) {
  await telegramRequest<boolean>("deleteMessage", {
    chat_id: chatId,
    message_id: messageId
  });
}

export async function sendChatMessage(chatId: number, text: string) {
  await sendTelegramMessage(chatId, text);
}

function compactLeadLine(lead: WithId<LeadDocument>) {
  return `#${lead.leadNumber} | ${getSourceLabel(lead.source)} | ${lead.name} | ${lead.phone}`;
}

export async function sendLeadList(chatId: number, status: "new" | "in_progress") {
  const leads = await listLeads(status, 10);
  const title = status === "new" ? "Новые заявки" : "Заявки в работе";

  if (!leads.length) {
    await sendChatMessage(chatId, `${title}: пусто.`);
    return;
  }

  await sendChatMessage(chatId, `${title}:\n${leads.map(compactLeadLine).join("\n")}`);
}

export async function retryFailedLeadDelivery(chatId: number) {
  const leads = await findFailedTelegramLeads(10);

  if (!leads.length) {
    await sendChatMessage(chatId, "Заявок с ошибкой отправки нет.");
    return;
  }

  let sent = 0;

  for (const lead of leads) {
    try {
      await sendLeadToTelegram(lead);
      sent += 1;
    } catch {
      // Одна битая заявка не должна останавливать повторную отправку остальных.
    }
  }

  await sendChatMessage(chatId, `Повторная отправка завершена. Отправлено: ${sent}/${leads.length}.`);
}
