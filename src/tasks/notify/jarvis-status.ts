import { toTaskOwnerZh, toTaskStatusZh } from "../board/labels.js";
import type { TaskStore } from "../store.js";
import type { TaskRecord } from "../types.js";

export type TaskNotificationStore = Pick<TaskStore, "appendEvent" | "getTask" | "listTasks">;

export type JarvisTaskNotifier = {
  notifyFailure: (task: TaskRecord) => Promise<{ sent: boolean; text?: string }>;
  notifySummary: (tasks: TaskRecord[]) => Promise<{ sent: boolean; text?: string }>;
};

const SUMMARY_COOLDOWN_MS = 30 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 30 * 60 * 1000;

let defaultNotifier: JarvisTaskNotifier | null = null;

function toSummaryBuckets(tasks: TaskRecord[]) {
  let running = 0;
  let waiting = 0;
  let done = 0;
  let failed = 0;

  for (const task of tasks) {
    if (task.status === "running" || task.status === "dispatched") {
      running += 1;
      continue;
    }
    if (task.status === "pending" || task.status === "waiting") {
      waiting += 1;
      continue;
    }
    if (task.status === "done") {
      done += 1;
      continue;
    }
    if (task.status === "failed") {
      failed += 1;
    }
  }

  return { running, waiting, done, failed };
}

export function buildJarvisTaskStatusSummary(tasks: TaskRecord[]): string {
  const buckets = toSummaryBuckets(tasks);
  return [
    "任务状态摘要",
    `进行中：${buckets.running} 项`,
    `等待中：${buckets.waiting} 项`,
    `已完成：${buckets.done} 项`,
    `失败：${buckets.failed} 项`,
  ].join("\n");
}

export function formatJarvisTaskFailureAlert(task: TaskRecord): string {
  return [
    "失败告警",
    `任务：${task.instruction}`,
    `负责人：${toTaskOwnerZh(task.ownerAgent)}`,
    `状态：${toTaskStatusZh(task.status)}`,
    `错误：${task.lastError ?? task.resultSummary ?? "未知错误"}`,
  ].join("\n");
}

export function createJarvisTaskNotifier(params: {
  send: (text: string) => Promise<void> | void;
  now?: () => number;
  summaryCooldownMs?: number;
  failureCooldownMs?: number;
}): JarvisTaskNotifier {
  const now = params.now ?? Date.now;
  const summaryCooldownMs = params.summaryCooldownMs ?? SUMMARY_COOLDOWN_MS;
  const failureCooldownMs = params.failureCooldownMs ?? FAILURE_COOLDOWN_MS;
  let lastSummaryFingerprint = "";
  let lastSummaryAt = 0;
  const lastFailureAtByTaskId = new Map<string, number>();

  return {
    async notifyFailure(task: TaskRecord) {
      if (task.status !== "failed") {
        return { sent: false };
      }
      const currentNow = now();
      const lastFailureAt = lastFailureAtByTaskId.get(task.taskId) ?? 0;
      if (currentNow - lastFailureAt < failureCooldownMs) {
        return { sent: false };
      }
      const text = formatJarvisTaskFailureAlert(task);
      await params.send(text);
      lastFailureAtByTaskId.set(task.taskId, currentNow);
      return { sent: true, text };
    },

    async notifySummary(tasks: TaskRecord[]) {
      const currentNow = now();
      const text = buildJarvisTaskStatusSummary(tasks);
      if (text === lastSummaryFingerprint && currentNow - lastSummaryAt < summaryCooldownMs) {
        return { sent: false };
      }
      await params.send(text);
      lastSummaryFingerprint = text;
      lastSummaryAt = currentNow;
      return { sent: true, text };
    },
  };
}

export function setJarvisTaskNotifier(notifier: JarvisTaskNotifier | null) {
  defaultNotifier = notifier;
}

export async function requestTaskFailureNotification(
  taskId: string,
  store: TaskNotificationStore,
  notifier: JarvisTaskNotifier | null = defaultNotifier,
) {
  if (!notifier) {
    return null;
  }
  const task = store.getTask(taskId);
  if (!task || task.status !== "failed") {
    return null;
  }
  try {
    const result = await notifier.notifyFailure(task);
    if (result.sent) {
      store.appendEvent({
        taskId,
        eventType: "notify_sent",
        actor: "system",
        payload: { kind: "failure_alert" },
      });
    }
    return result;
  } catch (error) {
    store.appendEvent({
      taskId,
      eventType: "notify_error",
      actor: "system",
      payload: { error: error instanceof Error ? error.message : String(error) },
    });
    return null;
  }
}

export async function runJarvisPeriodicSummary(
  store: TaskNotificationStore,
  notifier: JarvisTaskNotifier | null = defaultNotifier,
) {
  if (!notifier) {
    return null;
  }
  const tasks = store.listTasks();
  try {
    const result = await notifier.notifySummary(tasks);
    if (result.sent) {
      store.appendEvent({
        taskId: tasks[0]?.taskId ?? "summary",
        eventType: "notify_sent",
        actor: "system",
        payload: { kind: "periodic_summary" },
      });
    }
    return result;
  } catch (error) {
    store.appendEvent({
      taskId: tasks[0]?.taskId ?? "summary",
      eventType: "notify_error",
      actor: "system",
      payload: { error: error instanceof Error ? error.message : String(error) },
    });
    return null;
  }
}
