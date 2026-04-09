import { describe, expect, it, vi } from "vitest";
import { createFeishuBitableClient, LarkApiError } from "./bitable-client.js";

type MockRecord = {
  record_id?: string;
  fields?: Record<string, unknown>;
};

function createMockLarkClient() {
  return {
    bitable: {
      appTableRecord: {
        list: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    },
  };
}

describe("createFeishuBitableClient", () => {
  it("finds records by field value across paginated record pages", async () => {
    const mockClient = createMockLarkClient();
    mockClient.bitable.appTableRecord.list
      .mockResolvedValueOnce({
        code: 0,
        data: {
          items: [
            { record_id: "rec_1", fields: { task_id: "task-a" } } satisfies MockRecord,
            { record_id: "rec_2", fields: { task_id: "task-b" } } satisfies MockRecord,
          ],
          has_more: true,
          page_token: "next-1",
          total: 3,
        },
      })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          items: [{ record_id: "rec_3", fields: { task_id: "task-b" } } satisfies MockRecord],
          has_more: false,
          total: 3,
        },
      });

    const client = createFeishuBitableClient(mockClient as never, "app-token", "table-id");
    const records = await client.findRecordsByField("task_id", "task-b");

    expect(records.map((record) => record.record_id)).toEqual(["rec_2", "rec_3"]);
    expect(mockClient.bitable.appTableRecord.list).toHaveBeenNthCalledWith(1, {
      path: { app_token: "app-token", table_id: "table-id" },
      params: { page_size: 100 },
    });
    expect(mockClient.bitable.appTableRecord.list).toHaveBeenNthCalledWith(2, {
      path: { app_token: "app-token", table_id: "table-id" },
      params: { page_size: 100, page_token: "next-1" },
    });
  });

  it("throws LarkApiError when list response is non-zero", async () => {
    const mockClient = createMockLarkClient();
    mockClient.bitable.appTableRecord.list.mockResolvedValue({
      code: 1254290,
      msg: "request denied",
      data: { items: [], has_more: false, total: 0 },
    });

    const client = createFeishuBitableClient(mockClient as never, "app-token", "table-id");

    await expect(client.findRecordsByField("task_id", "task-b")).rejects.toBeInstanceOf(
      LarkApiError,
    );
  });

  it("creates and updates records for upsert building blocks", async () => {
    const mockClient = createMockLarkClient();
    mockClient.bitable.appTableRecord.create.mockResolvedValue({
      code: 0,
      data: { record: { record_id: "rec_new" } },
    });
    mockClient.bitable.appTableRecord.update.mockResolvedValue({
      code: 0,
      data: { record: { record_id: "rec_existing" } },
    });

    const client = createFeishuBitableClient(mockClient as never, "app-token", "table-id");
    const created = await client.createRecord({ task_id: "task-1", 状态: "进行中" });
    const updated = await client.updateRecord("rec_existing", { 状态: "已完成" });

    expect(created.record?.record_id).toBe("rec_new");
    expect(updated.record?.record_id).toBe("rec_existing");
    expect(mockClient.bitable.appTableRecord.create).toHaveBeenCalledWith({
      path: { app_token: "app-token", table_id: "table-id" },
      data: { fields: { task_id: "task-1", 状态: "进行中" } },
    });
    expect(mockClient.bitable.appTableRecord.update).toHaveBeenCalledWith({
      path: { app_token: "app-token", table_id: "table-id", record_id: "rec_existing" },
      data: { fields: { 状态: "已完成" } },
    });
  });
});
