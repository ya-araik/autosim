import { fetch as undiciFetch, ProxyAgent } from "undici";

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const proxyUrl = process.env.TELEGRAM_PROXY_URL?.trim();
const internalWebhookUrl =
  process.env.TELEGRAM_INTERNAL_WEBHOOK_URL?.trim() ||
  "http://autosim:3000/api/telegram/webhook";

if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
if (!webhookSecret) throw new Error("TELEGRAM_WEBHOOK_SECRET is required");

const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
const apiUrl = `https://api.telegram.org/bot${token}`;
let stopping = false;
let offset;

process.on("SIGTERM", () => {
  stopping = true;
});

process.on("SIGINT", () => {
  stopping = true;
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function telegramRequest(method, body, timeoutMs = 65_000) {
  const response = await undiciFetch(`${apiUrl}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    dispatcher,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram ${method} request failed`);
  }

  return data.result;
}

async function disableWebhook() {
  await telegramRequest("deleteWebhook", { drop_pending_updates: false }, 10_000);
  console.log("Telegram webhook disabled; long polling started.");
}

async function forwardUpdate(update) {
  const response = await undiciFetch(internalWebhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": webhookSecret
    },
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) {
    throw new Error(`Internal webhook returned HTTP ${response.status}`);
  }
}

while (!stopping) {
  try {
    await disableWebhook();
    break;
  } catch (error) {
    console.error("Cannot disable Telegram webhook", error);
    await sleep(5_000);
  }
}

while (!stopping) {
  try {
    const updates = await telegramRequest("getUpdates", {
      offset,
      timeout: 50,
      allowed_updates: ["message", "callback_query", "my_chat_member"]
    });

    for (const update of updates) {
      await forwardUpdate(update);
      offset = update.update_id + 1;
    }
  } catch (error) {
    if (!stopping) {
      console.error("Telegram polling error", error);
      await sleep(3_000);
    }
  }
}

console.log("Telegram long polling stopped.");
