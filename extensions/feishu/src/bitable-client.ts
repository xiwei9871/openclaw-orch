import type * as Lark from "@larksuiteoapi/node-sdk";

type LarkResponse<T = unknown> = { code?: number; msg?: string; data?: T };

export type BitableRecord = {
  record_id?: string;
  fields?: Record<string, unknown>;
};

export class LarkApiError extends Error {
  readonly code: number;
  readonly api: string;
  readonly context?: Record<string, unknown>;
  constructor(code: number, message: string, api: string, context?: Record<string, unknown>) {
    super(`[${api}] code=${code} message=${message}`);
    this.name = "LarkApiError";
    this.code = code;
    this.api = api;
    this.context = context;
  }
}

export function ensureLarkSuccess<T>(
  res: LarkResponse<T>,
  api: string,
  context?: Record<string, unknown>,
): asserts res is LarkResponse<T> & { code: 0 } {
  if (res.code !== 0) {
    throw new LarkApiError(res.code ?? -1, res.msg ?? "unknown error", api, context);
  }
}

export function createFeishuBitableClient(client: Lark.Client, appToken: string, tableId: string) {
  return {
    async listRecords(pageSize?: number, pageToken?: string) {
      const res = await client.bitable.appTableRecord.list({
        path: { app_token: appToken, table_id: tableId },
        params: {
          page_size: pageSize ?? 100,
          ...(pageToken && { page_token: pageToken }),
        },
      });
      ensureLarkSuccess(res, "bitable.appTableRecord.list", { appToken, tableId, pageSize });
      return {
        records: (res.data?.items ?? []) as BitableRecord[],
        has_more: res.data?.has_more ?? false,
        page_token: res.data?.page_token,
        total: res.data?.total,
      };
    },

    async findRecordsByField(fieldName: string, fieldValue: unknown): Promise<BitableRecord[]> {
      let pageToken: string | undefined;
      const matches: BitableRecord[] = [];
      while (true) {
        const page = await this.listRecords(100, pageToken);
        matches.push(...page.records.filter((record) => record.fields?.[fieldName] === fieldValue));
        if (!page.has_more || !page.page_token) {
          return matches;
        }
        pageToken = page.page_token;
      }
    },

    async createRecord(fields: Record<string, unknown>) {
      const res = await client.bitable.appTableRecord.create({
        path: { app_token: appToken, table_id: tableId },
        // oxlint-disable-next-line typescript/no-explicit-any
        data: { fields: fields as any },
      });
      ensureLarkSuccess(res, "bitable.appTableRecord.create", { appToken, tableId });
      return {
        record: res.data?.record as BitableRecord | undefined,
      };
    },

    async updateRecord(recordId: string, fields: Record<string, unknown>) {
      const res = await client.bitable.appTableRecord.update({
        path: { app_token: appToken, table_id: tableId, record_id: recordId },
        // oxlint-disable-next-line typescript/no-explicit-any
        data: { fields: fields as any },
      });
      ensureLarkSuccess(res, "bitable.appTableRecord.update", { appToken, tableId, recordId });
      return {
        record: res.data?.record as BitableRecord | undefined,
      };
    },
  };
}
