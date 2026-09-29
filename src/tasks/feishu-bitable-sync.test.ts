import { describe, expect, it } from "vitest";
import {
  syncBitableProjectionToFeishu,
  type FeishuBitableClient,
  type FeishuBitableProjection,
  type FeishuBitableSyncTarget,
} from "./feishu-bitable-sync.js";

const TARGET: FeishuBitableSyncTarget = {
  appToken: "app-token",
  tableId: "tbl-test",
  rowKeyFieldName: "对象ID",
};

function createProjection(rowKeys: string[]): FeishuBitableProjection {
  return {
    fields: [
      { key: "对象ID", fieldType: 1 },
      { key: "Name", fieldType: 1 },
    ],
    rows: rowKeys.map((rowKey) => ({
      rowKey,
      fields: { Name: `job-${rowKey}` },
    })),
    views: [],
  };
}

type FakeRecord = { record_id: string; fields: Record<string, unknown> };

function createFakeClient(
  seedRecords: Array<{ record_id: string; fields: Record<string, unknown> }> = [],
) {
  const state = {
    fields: [] as Array<{ field_id: string; field_name: string; type: number }>,
    records: seedRecords.map((record) => ({
      record_id: record.record_id,
      fields: { ...record.fields },
    })) as FakeRecord[],
    writes: { fieldsCreated: 0, recordsCreated: 0, recordsUpdated: 0 },
  };
  let fieldSeq = 0;
  let recordSeq = seedRecords.length;
  const client = {
    state,
    bitable: {
      appTableField: {
        list: async () => ({ code: 0, data: { items: state.fields } }),
        create: async ({ data }: { data?: { field_name?: string; type?: number } }) => {
          fieldSeq += 1;
          state.writes.fieldsCreated += 1;
          const field = {
            field_id: `fld_${fieldSeq}`,
            field_name: String(data?.field_name ?? ""),
            type: Number(data?.type ?? 1),
          };
          state.fields.push(field);
          return { code: 0, data: { field } };
        },
      },
      appTableRecord: {
        list: async () => ({
          code: 0,
          data: { items: state.records, has_more: false },
        }),
        batchCreate: async ({
          data,
        }: {
          data?: { records?: Array<{ fields: Record<string, unknown> }> };
        }) => {
          for (const record of data?.records ?? []) {
            recordSeq += 1;
            state.writes.recordsCreated += 1;
            state.records.push({ record_id: `rec_${recordSeq}`, fields: { ...record.fields } });
          }
          return { code: 0, data: {} };
        },
        batchUpdate: async ({
          data,
        }: {
          data?: { records?: Array<{ record_id?: string; fields: Record<string, unknown> }> };
        }) => {
          for (const record of data?.records ?? []) {
            state.writes.recordsUpdated += 1;
            const existing = state.records.find((row) => row.record_id === record.record_id);
            if (existing) {
              existing.fields = { ...record.fields };
            }
          }
          return { code: 0, data: {} };
        },
      },
      appTableView: {
        list: async () => ({ code: 0, data: { items: [] } }),
      },
    },
  };
  return client as unknown as FeishuBitableClient & { state: typeof state };
}

describe("syncBitableProjectionToFeishu duplicate rowKey guard", () => {
  it("rejects duplicate projection row keys before any write", async () => {
    const client = createFakeClient();
    await expect(
      syncBitableProjectionToFeishu({
        projection: createProjection(["job-1", "job-2", "job-1"]),
        target: TARGET,
        client,
      }),
    ).rejects.toThrow(/对象ID.*job-1.*x2|job-1.*x2.*对象ID/s);
    expect(client.state.writes).toEqual({
      fieldsCreated: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
    });
  });

  it("rejects duplicate existing row keys before any write", async () => {
    const client = createFakeClient([
      { record_id: "rec_a", fields: { 对象ID: "job-1" } },
      { record_id: "rec_b", fields: { 对象ID: "job-1" } },
    ]);
    await expect(
      syncBitableProjectionToFeishu({
        projection: createProjection(["job-1"]),
        target: TARGET,
        client,
      }),
    ).rejects.toThrow(/existing records.*job-1.*x2/s);
    expect(client.state.writes).toEqual({
      fieldsCreated: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
    });
    expect(client.state.records).toHaveLength(2);
  });

  it("updates the existing row when the row key is unique", async () => {
    const client = createFakeClient([{ record_id: "rec_a", fields: { 对象ID: "job-1" } }]);
    const result = await syncBitableProjectionToFeishu({
      projection: createProjection(["job-1", "job-2"]),
      target: TARGET,
      client,
    });
    expect(result.rowsCreated).toBe(1);
    expect(result.rowsUpdated).toBe(1);
    const updated = client.state.records.find((row) => row.record_id === "rec_a");
    expect(updated?.fields?.["Name"]).toBe("job-job-1");
    expect(updated?.fields?.["对象ID"]).toBe("job-1");
  });

  it("creates rows on an empty table", async () => {
    const client = createFakeClient();
    const result = await syncBitableProjectionToFeishu({
      projection: createProjection(["job-1", "job-2"]),
      target: TARGET,
      client,
    });
    expect(result.rowsCreated).toBe(2);
    expect(result.rowsUpdated).toBe(0);
    const keys = client.state.records.map((row) => row.fields["对象ID"]);
    expect(new Set(keys).size).toBe(2);
  });
});
