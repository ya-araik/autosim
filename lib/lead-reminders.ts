import type { Filter, WithId } from "mongodb";

import {
  formatTelegramUser,
  recordLeadEvent,
  type LeadDocument,
  type LeadReminderKey,
  type LeadStatus
} from "@/lib/leads";
import { getDb } from "@/lib/mongo";
import {
  getTelegramMessageUrl,
  sendTelegramMessage,
  type TelegramInlineKeyboard
} from "@/lib/telegram";
import { getSourceLabel } from "@/lib/source-labels";

type ReminderRule = {
  key: LeadReminderKey;
  status: Extract<LeadStatus, "new" | "in_progress">;
  minutes: number;
  ageLabel: string;
  dateField: "createdAt" | "assignedAt";
  markKeys: LeadReminderKey[];
};

const reminderRules: ReminderRule[] = [
  {
    key: "new_15m",
    status: "new",
    minutes: 15,
    ageLabel: "Новая заявка висит больше 15 минут",
    dateField: "createdAt",
    markKeys: ["new_5m", "new_10m", "new_15m"]
  },
  {
    key: "new_10m",
    status: "new",
    minutes: 10,
    ageLabel: "Новая заявка висит больше 10 минут",
    dateField: "createdAt",
    markKeys: ["new_5m", "new_10m"]
  },
  {
    key: "new_5m",
    status: "new",
    minutes: 5,
    ageLabel: "Новая заявка висит больше 5 минут",
    dateField: "createdAt",
    markKeys: ["new_5m"]
  },
  {
    key: "in_progress_5h",
    status: "in_progress",
    minutes: 5 * 60,
    ageLabel: "Заявка в работе больше 5 часов",
    dateField: "assignedAt",
    markKeys: ["in_progress_1h", "in_progress_3h", "in_progress_5h"]
  },
  {
    key: "in_progress_3h",
    status: "in_progress",
    minutes: 3 * 60,
    ageLabel: "Заявка в работе больше 3 часов",
    dateField: "assignedAt",
    markKeys: ["in_progress_1h", "in_progress_3h"]
  },
  {
    key: "in_progress_1h",
    status: "in_progress",
    minutes: 60,
    ageLabel: "Заявка в работе больше часа",
    dateField: "assignedAt",
    markKeys: ["in_progress_1h"]
  }
];

function escapeHtml(value: string | number | undefined | null) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function reminderMessage(lead: WithId<LeadDocument>, rule: ReminderRule) {
  const lines = [
    `<b>Напоминание по заявке #${lead.leadNumber}</b>`,
    "",
    `<b>${escapeHtml(rule.ageLabel)}</b>`,
    `<b>Источник:</b> ${escapeHtml(getSourceLabel(lead.source))}`,
    `<b>Имя:</b> ${escapeHtml(lead.name)}`,
    `<b>Телефон:</b> <code>${escapeHtml(lead.phone)}</code>`
  ];

  if (lead.assignedTo) {
    lines.push(`<b>Ответственный:</b> ${escapeHtml(formatTelegramUser(lead.assignedTo))}`);
  }

  return lines.join("\n");
}

function reminderKeyboard(lead: WithId<LeadDocument>): TelegramInlineKeyboard | undefined {
  if (!lead.telegramChatId || !lead.telegramMessageId) return undefined;

  const url = getTelegramMessageUrl(lead.telegramChatId, lead.telegramMessageId);

  if (!url) return undefined;

  return {
    inline_keyboard: [[{ text: "Открыть заявку", url }]]
  };
}

async function markReminderSent(lead: WithId<LeadDocument>, rule: ReminderRule) {
  const db = await getDb();
  const sentAt = new Date();
  const $set = rule.markKeys.reduce<Record<string, Date>>((acc, key) => {
    acc[`remindersSentAt.${key}`] = sentAt;
    return acc;
  }, {});

  await db.collection<LeadDocument>("leads").updateOne(
    { _id: lead._id },
    {
      $set: {
        ...$set,
        updatedAt: sentAt
      }
    }
  );

  await recordLeadEvent(lead._id, "reminder_sent", {
    key: rule.key,
    status: rule.status,
    minutes: rule.minutes
  });
}

export async function processLeadReminders(limitPerRule = 20) {
  const db = await getDb();
  const now = new Date();

  for (const rule of reminderRules) {
    const cutoff = new Date(now.getTime() - rule.minutes * 60 * 1000);
    const filter: Filter<LeadDocument> = {
      status: rule.status,
      telegramDeliveryStatus: "sent",
      telegramChatId: { $exists: true },
      telegramMessageId: { $exists: true },
      [rule.dateField]: { $lte: cutoff },
      [`remindersSentAt.${rule.key}`]: { $exists: false }
    };
    const leads = await db
      .collection<LeadDocument>("leads")
      .find(filter)
      .sort({ [rule.dateField]: 1 })
      .limit(limitPerRule)
      .toArray();

    for (const lead of leads) {
      if (!lead.telegramChatId) continue;

      await sendTelegramMessage(
        lead.telegramChatId,
        reminderMessage(lead, rule),
        reminderKeyboard(lead)
      );
      await markReminderSent(lead, rule);
    }
  }
}
