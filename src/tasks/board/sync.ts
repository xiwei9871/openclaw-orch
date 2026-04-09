import type { TaskStore } from "../store.js";
import type { TaskRecord } from "../types.js";
import type { FeishuBoardAdapter } from "./feishu-board.js";
import { upsertTaskToFeishuBoard } from "./feishu-board.js";

export type TaskBoardSyncStore = Pick<
  TaskStore,
  "appendEvent" | "getTask" | "markTaskSyncSuccess" | "markTaskSyncError"
>;

export type TaskBoardSyncBoard = {
  upsertTask: (task: TaskRecord) => Promise<void>;
};

export type TaskBoardSyncDeps = {
  store: TaskBoardSyncStore;
  board: TaskBoardSyncBoard;
};

let defaultBoard: TaskBoardSyncBoard | null = null;

export function createTaskBoardSyncBoard(adapter: FeishuBoardAdapter): TaskBoardSyncBoard {
  return {
    async upsertTask(task: TaskRecord) {
      await upsertTaskToFeishuBoard(task, adapter);
    },
  };
}

export function setTaskBoardSyncBoard(board: TaskBoardSyncBoard | null) {
  defaultBoard = board;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function syncTaskToFeishuBoard(taskId: string, deps: TaskBoardSyncDeps) {
  const task = deps.store.getTask(taskId);
  if (!task) {
    return null;
  }
  try {
    await deps.board.upsertTask(task);
    return deps.store.markTaskSyncSuccess(taskId);
  } catch (error) {
    return deps.store.markTaskSyncError(taskId, toErrorMessage(error));
  }
}

export function requestTaskBoardSync(
  taskId: string,
  store: TaskBoardSyncStore,
  board: TaskBoardSyncBoard | null = defaultBoard,
) {
  if (!board) {
    return;
  }
  store.appendEvent({
    taskId,
    eventType: "sync_requested",
    actor: "system",
  });
  queueMicrotask(() => {
    void syncTaskToFeishuBoard(taskId, { store, board });
  });
}
