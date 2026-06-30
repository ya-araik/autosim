const webhookUrl = process.argv[2];
const token = process.env.TELEGRAM_BOT_TOKEN;
const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!webhookUrl) {
  console.error("Usage: npm run telegram:set-webhook -- https://auto-sim.ru/api/telegram/webhook");
  process.exit(1);
}

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}

if (!secretToken) {
  console.error("TELEGRAM_WEBHOOK_SECRET is required");
  process.exit(1);
}

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: {
    "content-type": "application/json"
  },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query", "my_chat_member"]
  })
});

const data = await response.json();

if (!response.ok || !data.ok) {
  console.error(data.description || "Failed to set Telegram webhook");
  process.exit(1);
}

console.log(`Telegram webhook set: ${webhookUrl}`);
