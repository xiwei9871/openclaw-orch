import type { TaskRecord } from "../types.js";
import { toTaskDepthZh, toTaskOwnerZh, toTaskStatusZh } from "./labels.js";

type FeishuBoardRecord = { record_id?: string };

export type FeishuBoardAdapter = {
  findRecordsByField: (fieldName: string, fieldValue: unknown) => Promise<FeishuBoardRecord[]>;
  createRecord: (fields: Record<string, unknown>) => Promise<{ record?: FeishuBoardRecord }>;
  updateRecord: (
    recordId: string,
    fields: Record<string, unknown>,
  ) => Promise<{ record?: FeishuBoardRecord }>;
};

function resolveTaskDepth(task: TaskRecord): "root" | "child" | "grandchild" {
  if (!task.parentTaskId) {
    return "root";
  }
  if (task.parentTaskId === task.rootTaskId) {
    return "child";
  }
  return "grandchild";
}

export function buildFeishuBoardPayload(task: TaskRecord): Record<string, unknown> {
  const depth = resolveTaskDepth(task);
  return {
    任务标题: task.instruction,
    任务ID: task.taskId,
    根任务ID: task.rootTaskId,
    父任务ID: task.parentTaskId,
    task_id: task.taskId,
    任务层级: toTaskDepthZh(depth),
    类型: task.taskType,
    来源: task.source,
    状态: toTaskStatusZh(task.status),
    状态原值: task.status,
    负责人: toTaskOwnerZh(task.ownerAgent),
    负责人原值: task.ownerAgent,
    优先级: task.priority,
    下一步: task.nextAction,
    结果摘要: task.resultSummary,
    最近错误: task.lastError,
    创建时间: task.createdAt,
    更新时间: task.updatedAt,
    完成时间: task.finishedAt,
    结果引用: task.resultRef,
  };
}

export async function upsertTaskToFeishuBoard(task: TaskRecord, adapter: FeishuBoardAdapter) {
  const payload = buildFeishuBoardPayload(task);
  const matches = await adapter.findRecordsByField("task_id", task.taskId);
  if (matches.length > 1) {
    throw new Error(`duplicate task_id matches for task ${task.taskId}`);
  }
  const existing = matches[0];
  if (existing?.record_id) {
    const updated = await adapter.updateRecord(existing.record_id, payload);
    return {
      action: "updated" as const,
      recordId: updated.record?.record_id ?? existing.record_id,
      payload,
    };
  }
  if (existing && !existing.record_id) {
    throw new Error(`matched record missing record_id for task ${task.taskId}`);
  }
  const created = await adapter.createRecord(payload);
  return {
    action: "created" as const,
    recordId: created.record?.record_id ?? null,
    payload,
  };
}
