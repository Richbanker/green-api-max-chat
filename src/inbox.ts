import { ApiError, errorMessage } from "./api.ts";
import type { GreenApi } from "./api.ts";
import { parseIncoming } from "./chat.ts";
import type { IncomingMessage } from "./types.ts";

export interface InboxStatus {
  state: "connecting" | "connected" | "retrying" | "stopped";
  error?: string;
}

export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function runInbox(
  api: GreenApi,
  signal: AbortSignal,
  onMessage: (message: IncomingMessage) => void,
  onStatus: (status: InboxStatus) => void,
  pause = wait,
): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    try {
      const notification = await api.receiveNotification(signal);
      if (signal.aborted) return;
      if (notification) {
        const message = parseIncoming(notification.body);
        if (message) onMessage(message);
        // Подтверждаем и пропущенные типы, иначе они заблокируют очередь.
        await api.deleteNotification(notification.receiptId, signal);
      }
      if (signal.aborted) return;
      failures = 0;
      onStatus({ state: "connected" });
      await pause(500, signal);
    } catch (error) {
      if (signal.aborted) return;
      if (!(error instanceof ApiError) || !error.retryable) {
        onStatus({ state: "stopped", error: errorMessage(error) });
        return;
      }
      failures += 1;
      onStatus({ state: "retrying", error: errorMessage(error) });
      try {
        await pause(
          Math.min(2000 * 2 ** Math.min(failures - 1, 4), 30000),
          signal,
        );
      } catch {
        return;
      }
    }
  }
}
