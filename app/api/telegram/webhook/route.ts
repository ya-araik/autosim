import { NextResponse } from "next/server";

import {
  runCompletionCommentTimeoutCheck,
  startCompletionCommentTimeoutWorker
} from "@/lib/completion-timeout-worker";
import { runLeadReminderCheck, startLeadReminderWorker } from "@/lib/lead-reminder-worker";
import {
  completeLeadFromReply,
  completeLead,
  formatTelegramUser,
  releaseLead,
  requestCompletionComment,
  takeLead
} from "@/lib/leads";
import {
  answerCallbackQuery,
  deleteMessage,
  editLeadTelegramMessage,
  isAllowedChat,
  retryFailedLeadDelivery,
  sendChatMessage,
  sendLeadList,
  toTelegramUserRef,
  type TelegramUpdate
} from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

startCompletionCommentTimeoutWorker();
startLeadReminderWorker();

function webhookSecret() {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!secret) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET is not configured");
  }

  return secret;
}

function commandName(text?: string) {
  return text?.trim().split(/\s+/)[0]?.split("@")[0].toLowerCase();
}

async function handleUnknownChat(chatId: number, text?: string) {
  if (commandName(text) === "/chat_id") {
    await sendChatMessage(chatId, `ID этого чата: ${chatId}`);
    return;
  }

  await sendChatMessage(
    chatId,
    `Этот чат не авторизован для AutoSim. ID этого чата: ${chatId}`
  );
}

async function handleMessage(update: TelegramUpdate) {
  const message = update.message;

  if (!message?.chat?.id) return;

  const chatId = message.chat.id;
  const name = commandName(message.text);

  if (!isAllowedChat(chatId)) {
    await handleUnknownChat(chatId, message.text);
    return;
  }

  if (message.reply_to_message?.message_id && message.text && !name?.startsWith("/")) {
    const user = message.from ? toTelegramUserRef(message.from) : null;

    if (!user) return;

    const result = await completeLeadFromReply(
      chatId,
      message.reply_to_message.message_id,
      user,
      message.text.trim()
    );

    if (result.ok) {
      await editLeadTelegramMessage(result.lead);

      try {
        await deleteMessage(chatId, message.message_id);
      } catch (error) {
        console.warn("Cannot delete completion comment message", error);
      }
    } else if (result.lead) {
      await sendChatMessage(chatId, result.reason);
    }

    return;
  }

  if (name === "/ping") {
    await sendChatMessage(chatId, "AutoSim bot online.");
    return;
  }

  if (name === "/chat_id") {
    await sendChatMessage(chatId, `ID этого чата: ${chatId}`);
    return;
  }

  if (name === "/new") {
    await sendLeadList(chatId, "new");
    return;
  }

  if (name === "/active") {
    await sendLeadList(chatId, "in_progress");
    return;
  }

  if (name === "/retry_failed") {
    await retryFailedLeadDelivery(chatId);
  }
}

async function handleCallback(update: TelegramUpdate) {
  const callback = update.callback_query;

  if (!callback?.data || !callback.message?.chat?.id) return;

  const chatId = callback.message.chat.id;

  if (!isAllowedChat(chatId)) {
    await answerCallbackQuery(callback.id, "Этот чат не авторизован.", true);
    return;
  }

  const [, leadId, action] = callback.data.split(":");
  const user = toTelegramUserRef(callback.from);

  if (!leadId || !["take", "done", "release", "comment"].includes(action)) {
    await answerCallbackQuery(callback.id, "Неизвестное действие.", true);
    return;
  }

  const result =
    action === "take"
      ? await takeLead(leadId, user)
      : action === "done"
        ? await completeLead(leadId, user)
        : action === "comment"
          ? await requestCompletionComment(leadId, user)
          : await releaseLead(leadId, user);

  if (!result.ok) {
    const owner = result.lead?.assignedTo ? ` Сейчас у ${formatTelegramUser(result.lead.assignedTo)}.` : "";
    await answerCallbackQuery(callback.id, `${result.reason}${owner}`, true);
    return;
  }

  await editLeadTelegramMessage(result.lead);

  const successText =
    action === "take"
      ? "Заявка взята в работу."
      : action === "done"
        ? "Заявка завершена."
        : action === "comment"
          ? "Ответьте на сообщение заявки комментарием."
          : "Заявка возвращена в новые.";

  await answerCallbackQuery(callback.id, successText);
}

async function handleChatMember(update: TelegramUpdate) {
  const chatId = update.my_chat_member?.chat.id;

  if (typeof chatId !== "number") return;

  // В dev не выходим из неизвестных чатов автоматически: Telegram может мигрировать
  // обычную группу в supergroup и поменять chat.id после добавления бота.
  if (!isAllowedChat(chatId)) return;
}

export async function POST(request: Request) {
  try {
    const secret = request.headers.get("x-telegram-bot-api-secret-token");

    if (secret !== webhookSecret()) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const update = (await request.json()) as TelegramUpdate;
    await runCompletionCommentTimeoutCheck();
    await runLeadReminderCheck();

    if (update.callback_query) {
      await handleCallback(update);
    } else if (update.message) {
      await handleMessage(update);
    } else if (update.my_chat_member) {
      await handleChatMember(update);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
