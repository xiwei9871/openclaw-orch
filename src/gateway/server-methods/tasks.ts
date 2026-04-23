import { randomUUID } from "node:crypto";
import { requestTaskBoardSync } from "../../tasks/board/sync.js";
import { requestTaskFailureNotification } from "../../tasks/notify/jarvis-status.js";
import {
  classifyTaskTypeFromInstruction,
  resolveHandoffSpec,
  resolveOwnerAgent,
} from "../../tasks/routing.js";
import { resolveTargetSessionKey } from "../../tasks/session-target.js";
import { TaskStore } from "../../tasks/store.js";
import {
  validateTasksCreateParams,
  validateTasksDispatchParams,
  validateTasksGetParams,
  validateTasksResultParams,
  validateTasksTreeParams,
  ErrorCodes,
  errorShape,
} from "../protocol/index.js";
import { agentHandlers } from "./agent.js";
import type { GatewayRequestHandlerOptions, GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

function respondMissingTask(taskId: string, respond: GatewayRequestHandlerOptions["respond"]) {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown task: ${taskId}`));
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}

async function dispatchTaskViaGatewayAgent(params: {
  taskId: string;
  sessionKey: string;
  ownerAgent: string;
  instruction: string;
  rootTaskId: string;
  parentTaskId: string | null;
  options: GatewayRequestHandlerOptions;
}): Promise<{ ok: boolean; runId?: string; error?: unknown }> {
  return await new Promise((resolve) => {
    void agentHandlers.agent({
      params: {
        message: JSON.stringify(
          {
            taskId: params.taskId,
            rootTaskId: params.rootTaskId,
            parentTaskId: params.parentTaskId,
            ownerAgent: params.ownerAgent,
            instruction: params.instruction,
          },
          null,
          2,
        ),
        sessionKey: params.sessionKey,
        deliver: false,
        idempotencyKey: `task-dispatch:${params.taskId}`,
      },
      respond: (ok, payload, error) => {
        const runId =
          payload &&
          typeof payload === "object" &&
          typeof (payload as { runId?: unknown }).runId === "string"
            ? ((payload as { runId: string }).runId ?? "")
            : undefined;
        resolve({ ok, runId, error });
      },
      context: params.options.context,
      req: {
        type: "req",
        id: `tasks-dispatch-${params.taskId}`,
        method: "agent",
      } as never,
      client: params.options.client,
      isWebchatConnect: params.options.isWebchatConnect,
    });
  });
}

export const tasksHandlers: GatewayRequestHandlers = {
  "tasks.create": ({ params, respond }) => {
    if (!assertValidParams(params, validateTasksCreateParams, "tasks.create", respond)) {
      return;
    }
    const p = params;
    const taskType = p.taskType ?? classifyTaskTypeFromInstruction(p.instruction);
    const ownerAgent = resolveOwnerAgent(taskType);
    const taskStore = new TaskStore();
    const taskId = randomUUID();
    const task = taskStore.createTask({
      taskId,
      parentTaskId: p.parentTaskId ?? null,
      rootTaskId: p.rootTaskId ?? null,
      source: p.source,
      sourceMessageId: p.sourceMessageId ?? null,
      sourceSessionKey: p.sourceSessionKey ?? null,
      sourceUserId: p.sourceUserId ?? null,
      taskType,
      instruction: p.instruction,
      ownerAgent,
    });
    requestTaskBoardSync(task.taskId, taskStore);
    respond(true, task, undefined);
  },

  "tasks.dispatch": async (options) => {
    const { params, respond } = options;
    if (!assertValidParams(params, validateTasksDispatchParams, "tasks.dispatch", respond)) {
      return;
    }
    const p = params;
    const taskStore = new TaskStore();
    const task = taskStore.getTask(p.taskId);
    if (!task) {
      respondMissingTask(p.taskId, respond);
      return;
    }

    const targetSessionKey = resolveTargetSessionKey({
      ownerAgent: task.ownerAgent,
      sourceSessionKey: task.sourceSessionKey,
    });
    const dispatched = await dispatchTaskViaGatewayAgent({
      taskId: task.taskId,
      sessionKey: targetSessionKey,
      ownerAgent: task.ownerAgent,
      instruction: task.instruction,
      rootTaskId: task.rootTaskId,
      parentTaskId: task.parentTaskId,
      options,
    });
    if (!dispatched.ok) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          toErrorMessage(dispatched.error, "task dispatch failed"),
        ),
      );
      return;
    }
    const updated = taskStore.markDispatched({
      taskId: task.taskId,
      targetSessionKey,
      targetRunId: dispatched.runId,
    });
    if (updated) {
      requestTaskBoardSync(updated.taskId, taskStore);
    }
    respond(true, updated, undefined);
  },

  "tasks.result": ({ params, respond }) => {
    if (!assertValidParams(params, validateTasksResultParams, "tasks.result", respond)) {
      return;
    }
    const p = params;
    const taskStore = new TaskStore();
    const task = taskStore.getTask(p.taskId);
    if (!task) {
      respondMissingTask(p.taskId, respond);
      return;
    }
    const resultPayloadJson =
      p.resultPayload === undefined ? null : JSON.stringify(p.resultPayload);
    const updatedTask = taskStore.completeTask({
      taskId: task.taskId,
      status: p.status,
      resultSummary: p.resultSummary ?? null,
      resultPayloadJson,
      resultRef: p.resultRef ?? null,
    });
    const resultPayload =
      p.resultPayload && typeof p.resultPayload === "object"
        ? (p.resultPayload as Record<string, unknown>)
        : undefined;
    const handoff = resolveHandoffSpec({
      nextAction: resultPayload?.nextAction,
      instruction: resultPayload?.instruction,
    });
    const createdTasks = [];
    const childTaskIdsToSync: string[] = [];
    if (handoff && updatedTask) {
      const childTask = taskStore.createTask({
        taskId: randomUUID(),
        parentTaskId: updatedTask.taskId,
        rootTaskId: updatedTask.rootTaskId,
        source: updatedTask.source,
        sourceMessageId: updatedTask.sourceMessageId,
        sourceSessionKey: updatedTask.sourceSessionKey,
        sourceUserId: updatedTask.sourceUserId,
        taskType: handoff.taskType,
        instruction: handoff.instruction,
        ownerAgent: handoff.ownerAgent,
      });
      taskStore.appendHandoff({
        fromTaskId: updatedTask.taskId,
        toTaskId: childTask.taskId,
        handoffKind: handoff.nextAction,
      });
      taskStore.appendEvent({
        taskId: updatedTask.taskId,
        eventType: "handoff_created",
        actor: p.agentId,
        payload: {
          nextAction: handoff.nextAction,
          childTaskId: childTask.taskId,
        },
      });
      createdTasks.push(childTask);
      childTaskIdsToSync.push(childTask.taskId);
    }
    if (updatedTask) {
      requestTaskBoardSync(updatedTask.taskId, taskStore);
      if (updatedTask.status === "failed") {
        void requestTaskFailureNotification(updatedTask.taskId, taskStore);
      }
    }
    for (const childTaskId of childTaskIdsToSync) {
      requestTaskBoardSync(childTaskId, taskStore);
    }
    respond(
      true,
      {
        task: updatedTask,
        createdTasks,
      },
      undefined,
    );
  },

  "tasks.get": ({ params, respond }) => {
    if (!assertValidParams(params, validateTasksGetParams, "tasks.get", respond)) {
      return;
    }
    const p = params;
    const task = new TaskStore().getTask(p.taskId);
    if (!task) {
      respondMissingTask(p.taskId, respond);
      return;
    }
    respond(true, task, undefined);
  },

  "tasks.tree": ({ params, respond }) => {
    if (!assertValidParams(params, validateTasksTreeParams, "tasks.tree", respond)) {
      return;
    }
    const p = params;
    const tree = new TaskStore().getTaskTree(p.taskId);
    if (!tree) {
      respondMissingTask(p.taskId, respond);
      return;
    }
    respond(true, tree, undefined);
  },
};
