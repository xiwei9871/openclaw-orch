import type { TaskStore } from "../store.js";
import type { TaskRecord } from "../types.js";

type BoardRecord = {
  record_id?: string;
  fields?: Record<string, unknown>;
};

export type TaskBoardReconcileStore = Pick<
  TaskStore,
  "listTasks" | "markTaskSyncError" | "markTaskSyncSuccess"
>;

export type TaskBoardReconcileBoard = {
  upsertTask: (task: TaskRecord) => Promise<void>;
  listRecords: () => Promise<BoardRecord[]>;
  updateRecord: (
    recordId: string,
    fields: Record<string, unknown>,
  ) => Promise<{ record?: BoardRecord }>;
};

export async function reconcileTaskBoard(params: {
  store: TaskBoardReconcileStore;
  board: TaskBoardReconcileBoard;
  mode: "incremental" | "full";
  now?: number;
  recentWindowMs?: number;
}) {
  const now = params.now ?? Date.now();
  const recentWindowMs = params.recentWindowMs ?? 24 * 60 * 60 * 1000;
  const updatedAfter = new Date(now - recentWindowMs).toISOString();

  const recentTasks =
    params.mode === "full" ? params.store.listTasks() : params.store.listTasks({ updatedAfter });
  const unsyncedTasks =
    params.mode === "full" ? [] : params.store.listTasks({ syncState: "sync_error" });
  const tasks = Array.from(
    new Map(
      [...recentTasks, ...unsyncedTasks].map(
        (task) => [task.taskId, task] satisfies [string, TaskRecord],
      ),
    ).values(),
  );

  let upserted = 0;
  let syncErrors = 0;
  for (const task of tasks) {
    try {
      await params.board.upsertTask(task);
      params.store.markTaskSyncSuccess(task.taskId);
      upserted += 1;
    } catch (error) {
      params.store.markTaskSyncError(
        task.taskId,
        error instanceof Error ? error.message : String(error),
      );
      syncErrors += 1;
    }
  }

  let orphaned = 0;
  if (params.mode === "full") {
    const taskIds = new Set(tasks.map((task) => task.taskId));
    const records = await params.board.listRecords();
    for (const record of records) {
      const recordTaskId =
        typeof record.fields?.task_id === "string" ? record.fields.task_id : null;
      if (!record.record_id || !recordTaskId || taskIds.has(recordTaskId)) {
        continue;
      }
      await params.board.updateRecord(record.record_id, { 最近错误: "孤立记录" });
      orphaned += 1;
    }
  }

  return {
    scanned: tasks.length,
    upserted,
    syncErrors,
    orphaned,
  };
}
