import { processLeadReminders } from "@/lib/lead-reminders";

type ReminderWorkerGlobal = typeof globalThis & {
  leadReminderWorker?: NodeJS.Timeout;
  leadReminderWorkerRunning?: boolean;
};

const globalForReminderWorker = globalThis as ReminderWorkerGlobal;

async function runReminderTick() {
  if (globalForReminderWorker.leadReminderWorkerRunning) return;

  globalForReminderWorker.leadReminderWorkerRunning = true;

  try {
    await processLeadReminders();
  } catch (error) {
    console.error("Lead reminder worker error", error);
  } finally {
    globalForReminderWorker.leadReminderWorkerRunning = false;
  }
}

export function startLeadReminderWorker() {
  if (globalForReminderWorker.leadReminderWorker) return;

  globalForReminderWorker.leadReminderWorker = setInterval(runReminderTick, 60 * 1000);
}

export async function runLeadReminderCheck() {
  await runReminderTick();
}
