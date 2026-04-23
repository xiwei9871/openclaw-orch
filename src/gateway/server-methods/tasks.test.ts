import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listGatewayMethods } from "../server-methods-list.js";
import { handleGatewayRequest } from "../server-methods.js";
import type { GatewayRequestContext } from "./types.js";

const mocks = vi.hoisted(() => ({
  gatewayAgent: vi.fn(),
  requestTaskBoardSync: vi.fn(),
  requestTaskFailureNotification: vi.fn(),
}));

vi.mock("./agent.js", async () => {
  const actual = await vi.importActual<typeof import("./agent.js")>("./agent.js");
  return {
    ...actual,
    agentHandlers: {
      ...actual.agentHandlers,
      agent: mocks.gatewayAgent,
    },
  };
});

vi.mock("../../tasks/board/sync.js", async () => {
  const actual = await vi.importActual<typeof import("../../tasks/board/sync.js")>(
    "../../tasks/board/sync.js",
  );
  return {
    ...actual,
    requestTaskBoardSync: mocks.requestTaskBoardSync,
  };
});

vi.mock("../../tasks/notify/jarvis-status.js", async () => {
  const actual = await vi.importActual<typeof import("../../tasks/notify/jarvis-status.js")>(
    "../../tasks/notify/jarvis-status.js",
  );
  return {
    ...actual,
    requestTaskFailureNotification: mocks.requestTaskFailureNotification,
  };
});

function makeContext(): GatewayRequestContext {
  return {
    dedupe: new Map(),
    logGateway: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    addChatRun: vi.fn(),
    deps: {} as never,
  } as unknown as GatewayRequestContext;
}

async function runGatewayMethod(method: string, params: Record<string, unknown>) {
  const respond = vi.fn();
  await handleGatewayRequest({
    req: {
      type: "req",
      id: `${method}-req`,
      method,
      params,
    } as never,
    respond: respond as never,
    context: makeContext(),
    client: null,
    isWebchatConnect: () => false,
  });
  return respond;
}

describe("task orchestration gateway methods", () => {
  let stateDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-task-mvp-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    mocks.requestTaskBoardSync.mockImplementation(() => undefined);
    mocks.requestTaskFailureNotification.mockImplementation(async () => null);
    mocks.gatewayAgent.mockImplementation(async ({ respond }) => {
      respond(
        true,
        {
          runId: "run-dispatched-001",
          status: "ok",
        },
        undefined,
      );
      return undefined;
    });
  });

  afterEach(() => {
    delete process.env.OPENCLAW_STATE_DIR;
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("registers the task orchestration gateway methods", () => {
    expect(listGatewayMethods()).toEqual(
      expect.arrayContaining([
        "tasks.create",
        "tasks.dispatch",
        "tasks.result",
        "tasks.get",
        "tasks.tree",
      ]),
    );
  });

  it("creates, dispatches, hands off, and queries a task tree", async () => {
    const createRespond = await runGatewayMethod("tasks.create", {
      source: "feishu",
      sourceSessionKey: "agent:agent_jarvis:feishu:group:oc_test_group",
      instruction: "请调研最近的 agent orchestration 框架",
      taskType: "research",
    });

    expect(createRespond.mock.calls[0]?.[0]).toBe(true);
    expect(createRespond.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        taskId: expect.any(String),
        rootTaskId: expect.any(String),
        ownerAgent: "agent_athena",
        status: "pending",
        taskType: "research",
      }),
    );
    const createdTask = createRespond.mock.calls[0]?.[1] as {
      taskId: string;
      rootTaskId: string;
    };
    expect(createdTask.taskId).toBe(createdTask.rootTaskId);
    expect(mocks.requestTaskBoardSync).toHaveBeenNthCalledWith(
      1,
      createdTask.taskId,
      expect.anything(),
    );

    const dispatchRespond = await runGatewayMethod("tasks.dispatch", {
      taskId: createdTask.taskId,
    });

    expect(mocks.gatewayAgent).toHaveBeenCalledTimes(1);
    expect(mocks.gatewayAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          sessionKey: "agent:agent_athena:feishu:group:oc_test_group",
          deliver: false,
        }),
      }),
    );
    expect(dispatchRespond.mock.calls[0]?.[0]).toBe(true);
    expect(dispatchRespond.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        taskId: createdTask.taskId,
        ownerAgent: "agent_athena",
        status: "dispatched",
        targetSessionKey: "agent:agent_athena:feishu:group:oc_test_group",
        targetRunId: "run-dispatched-001",
      }),
    );
    expect(mocks.requestTaskBoardSync).toHaveBeenNthCalledWith(
      2,
      createdTask.taskId,
      expect.anything(),
    );

    const resultRespond = await runGatewayMethod("tasks.result", {
      taskId: createdTask.taskId,
      agentId: "agent_athena",
      status: "done",
      resultSummary: "已完成调研，建议先走 repo-native 轻量编排",
      resultPayload: {
        nextAction: "handoff_to_watson",
        instruction: "基于调研结果起草迁移和编排层方案",
      },
      resultRef: "session:agent:agent_athena:feishu:group:oc_test_group",
    });

    expect(resultRespond.mock.calls[0]?.[0]).toBe(true);
    expect(resultRespond.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        task: expect.objectContaining({
          taskId: createdTask.taskId,
          status: "done",
          resultSummary: "已完成调研，建议先走 repo-native 轻量编排",
        }),
        createdTasks: [
          expect.objectContaining({
            ownerAgent: "agent_watson",
            parentTaskId: createdTask.taskId,
            rootTaskId: createdTask.rootTaskId,
            status: "pending",
            taskType: "report",
          }),
        ],
      }),
    );
    expect(mocks.requestTaskBoardSync).toHaveBeenNthCalledWith(
      3,
      createdTask.taskId,
      expect.anything(),
    );
    const resultPayload = resultRespond.mock.calls[0]?.[1] as
      | {
          createdTasks: Array<{ taskId: string }>;
        }
      | undefined;
    const watsonTask = resultPayload?.createdTasks[0];
    expect(watsonTask).toBeDefined();
    if (!watsonTask) {
      throw new Error("expected watson handoff task to be created");
    }

    const watsonResultRespond = await runGatewayMethod("tasks.result", {
      taskId: watsonTask.taskId,
      agentId: "agent_watson",
      status: "done",
      resultSummary: "已完成方案初稿，交给 Jarvis 收口",
      resultPayload: {
        nextAction: "handoff_to_jarvis",
        instruction: "请汇总调研和方案初稿，形成最终答复。",
      },
      resultRef: "session:agent:agent_watson:feishu:group:oc_test_group",
    });

    expect(watsonResultRespond.mock.calls[0]?.[0]).toBe(true);
    expect(watsonResultRespond.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        task: expect.objectContaining({
          taskId: watsonTask.taskId,
          status: "done",
        }),
        createdTasks: [
          expect.objectContaining({
            ownerAgent: "agent_jarvis",
            parentTaskId: watsonTask.taskId,
            rootTaskId: createdTask.rootTaskId,
            taskType: "summary",
          }),
        ],
      }),
    );
    expect(mocks.requestTaskBoardSync).toHaveBeenNthCalledWith(
      5,
      watsonTask.taskId,
      expect.anything(),
    );

    const treeRespond = await runGatewayMethod("tasks.tree", {
      taskId: createdTask.taskId,
    });

    expect(treeRespond.mock.calls[0]?.[0]).toBe(true);
    expect(treeRespond.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        task: expect.objectContaining({
          taskId: createdTask.taskId,
          rootTaskId: createdTask.rootTaskId,
          status: "done",
        }),
        children: [
          expect.objectContaining({
            ownerAgent: "agent_watson",
            parentTaskId: createdTask.taskId,
            rootTaskId: createdTask.rootTaskId,
            status: "done",
            children: [
              expect.objectContaining({
                ownerAgent: "agent_jarvis",
                parentTaskId: watsonTask.taskId,
                rootTaskId: createdTask.rootTaskId,
                taskType: "summary",
              }),
            ],
          }),
        ],
      }),
    );
  });

  it("requests board sync when tasks.result marks a task as failed", async () => {
    const createRespond = await runGatewayMethod("tasks.create", {
      source: "feishu",
      sourceSessionKey: "agent:agent_jarvis:feishu:group:oc_test_group",
      instruction: "执行并返回失败状态",
      taskType: "code",
    });
    const createdTask = createRespond.mock.calls[0]?.[1] as {
      taskId: string;
    };

    const resultRespond = await runGatewayMethod("tasks.result", {
      taskId: createdTask.taskId,
      agentId: "agent_athena",
      status: "failed",
      resultSummary: "调用 bitable 接口失败",
      resultPayload: {
        error: "bitable timeout",
      },
    });

    expect(resultRespond.mock.calls[0]?.[0]).toBe(true);
    expect(resultRespond.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        task: expect.objectContaining({
          taskId: createdTask.taskId,
          status: "failed",
        }),
        createdTasks: [],
      }),
    );
    expect(mocks.requestTaskBoardSync).toHaveBeenNthCalledWith(
      2,
      createdTask.taskId,
      expect.anything(),
    );
    expect(mocks.requestTaskFailureNotification).toHaveBeenCalledWith(
      createdTask.taskId,
      expect.anything(),
    );
  });
});
