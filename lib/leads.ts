import { ObjectId, type Filter, type WithId } from "mongodb";

import { getDb, ensureMongoIndexes } from "@/lib/mongo";

export type LeadStatus = "new" | "in_progress" | "done";
export type TelegramDeliveryStatus = "pending" | "sent" | "failed";

export type TelegramUserRef = {
  userId: number;
  username?: string;
  displayName: string;
};

export type LeadReminderKey =
  | "new_5m"
  | "new_10m"
  | "new_15m"
  | "in_progress_1h"
  | "in_progress_3h"
  | "in_progress_5h";

export type LeadDocument = {
  leadNumber: number;
  name: string;
  phone: string;
  message: string;
  source: string;
  status: LeadStatus;
  telegramDeliveryStatus: TelegramDeliveryStatus;
  telegramDeliveryError?: string;
  telegramChatId?: number;
  telegramMessageId?: number;
  assignedTo?: TelegramUserRef;
  assignedAt?: Date;
  completedBy?: TelegramUserRef;
  completedAt?: Date;
  completionComment?: string;
  completionCommentRequestedBy?: TelegramUserRef;
  completionCommentRequestedAt?: Date;
  completionCommentExpiresAt?: Date;
  remindersSentAt?: Partial<Record<LeadReminderKey, Date>>;
  createdAt: Date;
  updatedAt: Date;
};

export type LeadEventType =
  | "created"
  | "telegram_sent"
  | "telegram_failed"
  | "taken"
  | "released"
  | "completion_comment_requested"
  | "completed"
  | "completed_without_comment_timeout"
  | "reminder_sent";

export type CreateLeadInput = {
  name: string;
  phone: string;
  message: string;
  source: string;
};

type CounterDocument = {
  _id: string;
  seq: number;
};

export type LeadActionResult =
  | { ok: true; lead: WithId<LeadDocument> }
  | { ok: false; reason: string; lead?: WithId<LeadDocument> | null };

function toObjectId(leadId: string) {
  if (!ObjectId.isValid(leadId)) {
    return null;
  }

  return new ObjectId(leadId);
}

export function formatTelegramUser(user: TelegramUserRef) {
  return user.username ? `@${user.username}` : `${user.displayName} (${user.userId})`;
}

async function nextLeadNumber() {
  const db = await getDb();
  const result = await db.collection<CounterDocument>("counters").findOneAndUpdate(
    { _id: "leads" },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );

  return Number(result?.seq ?? 1);
}

export async function recordLeadEvent(
  leadId: ObjectId,
  type: LeadEventType,
  payload: Record<string, unknown> = {}
) {
  const db = await getDb();
  await db.collection("lead_events").insertOne({
    leadId,
    type,
    payload,
    createdAt: new Date()
  });
}

export async function createLead(input: CreateLeadInput) {
  await ensureMongoIndexes();

  const db = await getDb();
  const now = new Date();
  const leadNumber = await nextLeadNumber();
  const lead: LeadDocument = {
    leadNumber,
    name: input.name,
    phone: input.phone,
    message: input.message,
    source: input.source,
    status: "new",
    telegramDeliveryStatus: "pending",
    createdAt: now,
    updatedAt: now
  };

  const result = await db.collection<LeadDocument>("leads").insertOne(lead);
  await recordLeadEvent(result.insertedId, "created", { source: input.source });

  return {
    _id: result.insertedId,
    ...lead
  };
}

export async function getLeadById(leadId: string) {
  const _id = toObjectId(leadId);

  if (!_id) return null;

  const db = await getDb();
  return db.collection<LeadDocument>("leads").findOne({ _id });
}

export async function markTelegramSent(
  leadId: ObjectId,
  telegramChatId: number,
  telegramMessageId: number
) {
  const db = await getDb();
  const updatedAt = new Date();

  await db.collection<LeadDocument>("leads").updateOne(
    { _id: leadId },
    {
      $set: {
        telegramChatId,
        telegramMessageId,
        telegramDeliveryStatus: "sent",
        updatedAt
      },
      $unset: {
        telegramDeliveryError: ""
      }
    }
  );

  await recordLeadEvent(leadId, "telegram_sent", { telegramChatId, telegramMessageId });
}

export async function markTelegramFailed(leadId: ObjectId, error: unknown) {
  const db = await getDb();
  const message = error instanceof Error ? error.message : String(error);

  await db.collection<LeadDocument>("leads").updateOne(
    { _id: leadId },
    {
      $set: {
        telegramDeliveryStatus: "failed",
        telegramDeliveryError: message,
        updatedAt: new Date()
      }
    }
  );

  await recordLeadEvent(leadId, "telegram_failed", { error: message });
}

export async function takeLead(leadId: string, user: TelegramUserRef): Promise<LeadActionResult> {
  const _id = toObjectId(leadId);

  if (!_id) return { ok: false, reason: "Некорректный идентификатор заявки." };

  const db = await getDb();
  const now = new Date();
  const result = await db.collection<LeadDocument>("leads").findOneAndUpdate(
    { _id, status: "new" },
    {
      $set: {
        status: "in_progress",
        assignedTo: user,
        assignedAt: now,
        updatedAt: now
      },
      $unset: {
        completedBy: "",
        completedAt: "",
        completionComment: "",
        completionCommentRequestedBy: "",
        completionCommentRequestedAt: "",
        completionCommentExpiresAt: ""
      }
    },
    { returnDocument: "after" }
  );

  if (result) {
    await recordLeadEvent(_id, "taken", { user });
    return { ok: true, lead: result };
  }

  const existing = await db.collection<LeadDocument>("leads").findOne({ _id });
  return { ok: false, reason: "Заявка уже не в статусе Новая.", lead: existing };
}

export async function releaseLead(
  leadId: string,
  user: TelegramUserRef
): Promise<LeadActionResult> {
  const _id = toObjectId(leadId);

  if (!_id) return { ok: false, reason: "Некорректный идентификатор заявки." };

  const db = await getDb();
  const now = new Date();
  const result = await db.collection<LeadDocument>("leads").findOneAndUpdate(
    { _id, status: "in_progress", "assignedTo.userId": user.userId },
    {
      $set: {
        status: "new",
        updatedAt: now
      },
      $unset: {
        assignedTo: "",
        assignedAt: "",
        completedBy: "",
        completedAt: "",
        completionComment: "",
        completionCommentRequestedBy: "",
        completionCommentRequestedAt: "",
        completionCommentExpiresAt: ""
      }
    },
    { returnDocument: "after" }
  );

  if (result) {
    await recordLeadEvent(_id, "released", { user });
    return { ok: true, lead: result };
  }

  const existing = await db.collection<LeadDocument>("leads").findOne({ _id });
  return { ok: false, reason: "Вернуть заявку в новые может только ответственный.", lead: existing };
}

export async function completeLead(
  leadId: string,
  user: TelegramUserRef,
  completionComment?: string
): Promise<LeadActionResult> {
  const _id = toObjectId(leadId);

  if (!_id) return { ok: false, reason: "Некорректный идентификатор заявки." };

  const db = await getDb();
  const now = new Date();
  const result = await db.collection<LeadDocument>("leads").findOneAndUpdate(
    { _id, status: "in_progress", "assignedTo.userId": user.userId },
    {
      $set: {
        status: "done",
        completedBy: user,
        completedAt: now,
        updatedAt: now,
        ...(completionComment ? { completionComment } : {})
      },
      $unset: {
        completionCommentRequestedBy: "",
        completionCommentRequestedAt: "",
        completionCommentExpiresAt: ""
      }
    },
    { returnDocument: "after" }
  );

  if (result) {
    await recordLeadEvent(_id, "completed", { user });
    return { ok: true, lead: result };
  }

  const existing = await db.collection<LeadDocument>("leads").findOne({ _id });
  return { ok: false, reason: "Завершить заявку может только ответственный.", lead: existing };
}

export async function requestCompletionComment(
  leadId: string,
  user: TelegramUserRef
): Promise<LeadActionResult> {
  const _id = toObjectId(leadId);

  if (!_id) return { ok: false, reason: "Некорректный идентификатор заявки." };

  const db = await getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
  const result = await db.collection<LeadDocument>("leads").findOneAndUpdate(
    { _id, status: "in_progress", "assignedTo.userId": user.userId },
    {
      $set: {
        completionCommentRequestedBy: user,
        completionCommentRequestedAt: now,
        completionCommentExpiresAt: expiresAt,
        updatedAt: now
      }
    },
    { returnDocument: "after" }
  );

  if (result) {
    await recordLeadEvent(_id, "completion_comment_requested", { user, expiresAt });
    return { ok: true, lead: result };
  }

  const existing = await db.collection<LeadDocument>("leads").findOne({ _id });
  return {
    ok: false,
    reason: "Комментарий завершения может запросить только ответственный.",
    lead: existing
  };
}

export async function completeLeadFromReply(
  telegramChatId: number,
  telegramMessageId: number,
  user: TelegramUserRef,
  completionComment: string
): Promise<LeadActionResult> {
  const db = await getDb();
  const now = new Date();
  const result = await db.collection<LeadDocument>("leads").findOneAndUpdate(
    {
      telegramChatId,
      telegramMessageId,
      status: "in_progress",
      "assignedTo.userId": user.userId,
      "completionCommentRequestedBy.userId": user.userId,
      completionCommentExpiresAt: { $gt: now }
    },
    {
      $set: {
        status: "done",
        completedBy: user,
        completedAt: now,
        completionComment,
        updatedAt: now
      },
      $unset: {
        completionCommentRequestedBy: "",
        completionCommentRequestedAt: "",
        completionCommentExpiresAt: ""
      }
    },
    { returnDocument: "after" }
  );

  if (result) {
    await recordLeadEvent(result._id, "completed", {
      user,
      completionComment,
      via: "reply"
    });
    return { ok: true, lead: result };
  }

  const existing = await db.collection<LeadDocument>("leads").findOne({
    telegramChatId,
    telegramMessageId
  });

  return {
    ok: false,
    reason: "Комментарий может оставить только ответственный, пока заявка ожидает комментарий.",
    lead: existing
  };
}

export async function completeExpiredCommentRequests(limit = 20) {
  const db = await getDb();
  const now = new Date();
  const expired = await db
    .collection<LeadDocument>("leads")
    .find({
      status: "in_progress",
      completionCommentExpiresAt: { $lte: now }
    })
    .limit(limit)
    .toArray();

  const completed: Array<WithId<LeadDocument>> = [];

  for (const lead of expired) {
    if (!lead.assignedTo) continue;

    const result = await db.collection<LeadDocument>("leads").findOneAndUpdate(
      {
        _id: lead._id,
        status: "in_progress",
        completionCommentExpiresAt: { $lte: now }
      },
      {
        $set: {
          status: "done",
          completedBy: lead.assignedTo,
          completedAt: now,
          updatedAt: now
        },
        $unset: {
          completionCommentRequestedBy: "",
          completionCommentRequestedAt: "",
          completionCommentExpiresAt: ""
        }
      },
      { returnDocument: "after" }
    );

    if (result) {
      await recordLeadEvent(result._id, "completed_without_comment_timeout", {
        user: lead.assignedTo
      });
      completed.push(result);
    }
  }

  return completed;
}

export async function listLeads(status: LeadStatus, limit = 10) {
  const db = await getDb();
  const filter: Filter<LeadDocument> = { status };

  return db
    .collection<LeadDocument>("leads")
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

export async function findFailedTelegramLeads(limit = 10) {
  const db = await getDb();

  return db
    .collection<LeadDocument>("leads")
    .find({ telegramDeliveryStatus: "failed", status: { $ne: "done" } })
    .sort({ createdAt: 1 })
    .limit(limit)
    .toArray();
}
