import { completeExpiredCommentRequests } from "@/lib/leads";
import { editLeadTelegramMessage } from "@/lib/telegram";

type TimeoutWorkerGlobal = typeof globalThis & {
  completionCommentTimeoutWorker?: NodeJS.Timeout;
  completionCommentTimeoutRunning?: boolean;
};

const globalForWorker = globalThis as TimeoutWorkerGlobal;

async function processExpiredCommentRequests() {
  if (globalForWorker.completionCommentTimeoutRunning) return;

  globalForWorker.completionCommentTimeoutRunning = true;

  try {
    const expiredLeads = await completeExpiredCommentRequests();

    for (const lead of expiredLeads) {
      await editLeadTelegramMessage(lead);
    }
  } catch (error) {
    console.error("Completion comment timeout worker error", error);
  } finally {
    globalForWorker.completionCommentTimeoutRunning = false;
  }
}

export function startCompletionCommentTimeoutWorker() {
  if (globalForWorker.completionCommentTimeoutWorker) return;

  globalForWorker.completionCommentTimeoutWorker = setInterval(
    processExpiredCommentRequests,
    60 * 1000
  );
}

export async function runCompletionCommentTimeoutCheck() {
  await processExpiredCommentRequests();
}
