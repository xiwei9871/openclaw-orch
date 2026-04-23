import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import type { TaskRecord } from "../task-registry.types.js";
import {
  syncTaskControlProjectionToFeishu,
  type FeishuTaskControlClient,
} from "./feishu-bitable.js";
import { buildTaskControlPlane } from "./model.js";
import { buildTaskControlProjectionLayer } from "./projection.js";

function createModel(now: number) {
  const tasks: TaskRecord[] = [
    {
      taskId: "task-1",
      runtime: "cli",
      requesterSessionKey: "agent:agent_jarvis:main",
      ownerKey: "agent:agent_jarvis:main",
      scopeKind: "session",
      agentId: "agent_jarvis",
      runId: "run-1",
      task: "Prepare daily task control report",
      status: "running",
      deliveryStatus: "pending",
      notifyPolicy: "done_only",
      createdAt: now - 10 * 60_000,
      startedAt: now - 9 * 60_000,
      lastEventAt: now - 2 * 60_000,
      progressSummary: "Collecting task health state",
    },
    {
      taskId: "task-2",
      runtime: "cron",
      requesterSessionKey: "",
      ownerKey: "system:cron:daily",
      scopeKind: "system",
      runId: "run-2",
      task: "Daily queued review",
      status: "queued",
      deliveryStatus: "not_applicable",
      notifyPolicy: "silent",
      createdAt: now - 25 * 60_000,
      lastEventAt: now - 20 * 60_000,
    },
    {
      taskId: "task-3",
      runtime: "cli",
      requesterSessionKey: "agent:agent_alpha:main",
      ownerKey: "agent:agent_alpha:main",
      scopeKind: "session",
      agentId: "agent_alpha",
      runId: "run-3",
      task: "Write projection adapter",
      status: "failed",
      deliveryStatus: "failed",
      notifyPolicy: "state_changes",
      createdAt: now - 30 * 60_000,
      startedAt: now - 29 * 60_000,
      endedAt: now - 27 * 60_000,
      lastEventAt: now - 27 * 60_000,
      error: "HTTP 401: invalid access token or token expired",
      terminalSummary: "Projection sync auth failure",
    },
  ];
  const model = buildTaskControlPlane({ now, tasks });
  return {
    model,
    projection: buildTaskControlProjectionLayer(model, {
      now,
      timeZone: "Asia/Shanghai",
    }).feishu,
  };
}

type FakeFieldCreatePayload = {
  data?: {
    field_name?: string;
    type?: number;
    property?: { options?: Array<{ name?: string }> };
  };
};

type FakeRecordCreatePayload = {
  data?: {
    fields?: Record<string, unknown>;
  };
};

type FakeRecordUpdatePayload = {
  data?: {
    fields?: Record<string, unknown>;
  };
  path?: {
    record_id?: string;
  };
};

type FakeRecordBatchPayload = {
  data?: {
    records?: Array<{
      record_id?: string;
      fields: Record<string, unknown>;
    }>;
  };
  path?: {
    record_id?: string;
  };
};

type FakeViewPayload = {
  data?: {
    view_name?: string;
    property?: Record<string, unknown>;
  };
  path?: {
    view_id?: string;
  };
};

function createFakeFeishuTaskControlClient(): FeishuTaskControlClient & {
  state: {
    fields: Array<{ field_id: string; field_name: string; type: number }>;
    records: Array<{ record_id: string; fields: Record<string, unknown> }>;
    views: Array<{ view_id: string; view_name: string; property?: Record<string, unknown> }>;
  };
} {
  const state = {
    fields: [] as Array<{
      field_id: string;
      field_name: string;
      type: number;
      property?: { options?: Array<{ id: string; name: string }> };
    }>,
    records: [] as Array<{ record_id: string; fields: Record<string, unknown> }>,
    views: [] as Array<{ view_id: string; view_name: string; property?: Record<string, unknown> }>,
  };
  let fieldSeq = 0;
  let recordSeq = 0;
  let viewSeq = 0;
  return {
    state,
    bitable: {
      appTableField: {
        list: async () => ({
          code: 0,
          data: {
            items: state.fields,
          },
        }),
        create: async ({ data }: FakeFieldCreatePayload) => {
          fieldSeq += 1;
          const property = data?.property as { options?: Array<{ name?: string }> } | undefined;
          const options = Array.isArray(property?.options)
            ? (property?.options ?? []).map((option, index) => ({
                id: `opt_${fieldSeq}_${index + 1}`,
                name: String(option.name ?? ""),
              }))
            : undefined;
          const field = {
            field_id: `fld_${fieldSeq}`,
            field_name: String(data?.field_name ?? ""),
            type: Number(data?.type ?? 1),
            ...(options ? { property: { options } } : {}),
          };
          state.fields.push(field);
          return {
            code: 0,
            data: {
              field,
            },
          };
        },
      },
      appTableRecord: {
        list: async () => ({
          code: 0,
          data: {
            items: state.records,
            has_more: false,
          },
        }),
        create: async ({ data }: FakeRecordCreatePayload) => {
          recordSeq += 1;
          state.records.push({
            record_id: `rec_${recordSeq}`,
            fields: { ...data?.fields },
          });
          return { code: 0, data: {} };
        },
        batchCreate: async ({ data }: FakeRecordBatchPayload) => {
          for (const record of data?.records ?? []) {
            recordSeq += 1;
            state.records.push({
              record_id: `rec_${recordSeq}`,
              fields: { ...record.fields },
            });
          }
          return { code: 0, data: {} };
        },
        update: async ({ path, data }: FakeRecordUpdatePayload) => {
          const record = state.records.find((entry) => entry.record_id === path?.record_id);
          if (!record) {
            return { code: 1, msg: "record missing" };
          }
          record.fields = { ...data?.fields };
          return { code: 0, data: {} };
        },
        batchUpdate: async ({ data }: FakeRecordBatchPayload) => {
          for (const next of data?.records ?? []) {
            const record = state.records.find((entry) => entry.record_id === next.record_id);
            if (!record) {
              return { code: 1, msg: "record missing" };
            }
            record.fields = { ...next.fields };
          }
          return { code: 0, data: {} };
        },
      },
      appTableView: {
        list: async () => ({
          code: 0,
          data: {
            items: state.views,
            has_more: false,
          },
        }),
        create: async ({ data }: FakeViewPayload) => {
          viewSeq += 1;
          const view = {
            view_id: `view_${viewSeq}`,
            view_name: String(data?.view_name ?? ""),
            property: {},
          };
          state.views.push(view);
          return {
            code: 0,
            data: {
              view,
            },
          };
        },
        patch: async ({ path, data }: FakeViewPayload) => {
          const view = state.views.find((entry) => entry.view_id === path?.view_id);
          if (!view) {
            return { code: 1, msg: "view missing" };
          }
          view.view_name = String(data?.view_name ?? view.view_name);
          view.property = { ...data?.property };
          return { code: 0, data: { view } };
        },
      },
    },
  } as unknown as FeishuTaskControlClient & {
    state: {
      fields: Array<{ field_id: string; field_name: string; type: number }>;
      records: Array<{ record_id: string; fields: Record<string, unknown> }>;
      views: Array<{ view_id: string; view_name: string; property?: Record<string, unknown> }>;
    };
  };
}

describe("task control plane feishu bitable sync", () => {
  it("creates missing fields, upserts rows, and materializes views", async () => {
    const now = Date.UTC(2026, 3, 10, 6, 0, 0);
    const { projection } = createModel(now);
    const client = createFakeFeishuTaskControlClient();

    const result = await syncTaskControlProjectionToFeishu({
      cfg: {} as OpenClawConfig,
      projection,
      target: {
        appToken: "app_token_1",
        tableId: "tbl_1",
        accountId: "default",
      },
      client,
    });

    expect(result.fieldsCreated.length).toBe(projection.fields.length);
    expect(result.rowsCreated).toBe(projection.rows.length);
    expect(result.rowsUpdated).toBe(0);
    expect(result.viewsCreated).toBe(projection.views.length);
    expect(result.totalViews).toBe(4);
    expect(client.state.records).toHaveLength(projection.rows.length);
    expect(client.state.views.map((view) => view.view_name)).toEqual([
      "总览",
      "异常",
      "今日队列",
      "Agent 视图",
    ]);
    const exceptionView = client.state.views.find((view) => view.view_name === "异常");
    expect(exceptionView?.property).toMatchObject({
      filter_info: {
        conjunction: "and",
        conditions: [
          expect.objectContaining({ value: expect.stringMatching(/^\["opt_\d+_1"\]$/) }),
        ],
      },
    });
  });

  it("updates existing rows and views on repeated sync", async () => {
    const now = Date.UTC(2026, 3, 10, 6, 0, 0);
    const { projection } = createModel(now);
    const client = createFakeFeishuTaskControlClient();

    await syncTaskControlProjectionToFeishu({
      cfg: {} as OpenClawConfig,
      projection,
      target: { appToken: "app_token_1", tableId: "tbl_1" },
      client,
    });

    const changedProjection = {
      ...projection,
      rows: projection.rows.map((row) =>
        row.taskId === "task-1"
          ? {
              ...row,
              fields: {
                ...row.fields,
                最近摘要: "Summary updated from second projection",
              },
            }
          : row,
      ),
    };

    const result = await syncTaskControlProjectionToFeishu({
      cfg: {} as OpenClawConfig,
      projection: changedProjection,
      target: { appToken: "app_token_1", tableId: "tbl_1" },
      client,
    });

    expect(result.fieldsCreated).toEqual([]);
    expect(result.rowsCreated).toBe(0);
    expect(result.rowsUpdated).toBe(changedProjection.rows.length);
    expect(result.viewsCreated).toBe(0);
    expect(result.viewsUpdated).toBe(changedProjection.views.length);
    const updatedRecord = client.state.records.find(
      (record) => record.fields["Task ID"] === "task-1",
    );
    expect(updatedRecord?.fields["最近摘要"]).toBe("Summary updated from second projection");
  });
});
