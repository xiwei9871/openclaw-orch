import type * as Lark from "@larksuiteoapi/node-sdk";
import { resolveFeishuRuntimeAccount } from "../../../extensions/feishu/src/accounts.js";
import { createFeishuClient } from "../../../extensions/feishu/src/client.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { FeishuTaskControlProjection, FeishuTaskControlView } from "./types.js";

type LarkResponse<T = unknown> = { code?: number; msg?: string; data?: T };

type BitableField = {
  field_id?: string;
  field_name?: string;
  type?: number;
  property?: {
    options?: Array<{
      id?: string;
      name?: string;
    }>;
  };
};

type BitableRecord = {
  record_id?: string;
  fields: Record<string, unknown>;
};

type BitableView = {
  view_id?: string;
  view_name?: string;
  property?: {
    filter_info?: {
      conjunction: "and" | "or";
      conditions: Array<{
        field_id: string;
        operator:
          | "is"
          | "isNot"
          | "contains"
          | "doesNotContain"
          | "isEmpty"
          | "isNotEmpty"
          | "isGreater"
          | "isGreaterEqual"
          | "isLess"
          | "isLessEqual";
        value?: string;
      }>;
    };
    hidden_fields?: string[];
  };
};

export type FeishuTaskControlClient = Pick<Lark.Client, "bitable">;

export type FeishuTaskControlSyncTarget = {
  appToken: string;
  tableId: string;
  accountId?: string;
  uniqueFieldName?: string;
};

export type FeishuTaskControlSyncResult = {
  accountId: string;
  appToken: string;
  tableId: string;
  uniqueFieldName: string;
  fieldsCreated: string[];
  rowsCreated: number;
  rowsUpdated: number;
  viewsCreated: number;
  viewsUpdated: number;
  totalRows: number;
  totalViews: number;
};

const TEXT_FIELD_TYPE = 1;
const DEFAULT_UNIQUE_FIELD_NAME = "Task ID";
const VIEW_FILTER_MARKERS = {
  异常: { fieldName: "异常视图", value: "异常" },
  今日队列: { fieldName: "今日队列视图", value: "今日队列" },
} as const;

function ensureLarkSuccess<T>(
  response: LarkResponse<T>,
  api: string,
): asserts response is LarkResponse<T> & { code: 0 } {
  if (response.code !== 0) {
    throw new Error(`[${api}] code=${response.code ?? -1} message=${response.msg ?? "unknown"}`);
  }
}

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function toFieldPayloadValue(value: string | number | null): string | number {
  if (typeof value === "number") {
    return value;
  }
  return value ?? "";
}

async function listAllFields(
  client: FeishuTaskControlClient,
  target: FeishuTaskControlSyncTarget,
): Promise<BitableField[]> {
  const response = (await client.bitable.appTableField.list({
    path: {
      app_token: target.appToken,
      table_id: target.tableId,
    },
  })) as LarkResponse<{ items?: BitableField[] }>;
  ensureLarkSuccess(response, "bitable.appTableField.list");
  return response.data?.items ?? [];
}

async function createField(
  client: FeishuTaskControlClient,
  target: FeishuTaskControlSyncTarget,
  fieldName: string,
  fieldType = TEXT_FIELD_TYPE,
  property?: Record<string, unknown>,
): Promise<BitableField> {
  const response = (await client.bitable.appTableField.create({
    path: {
      app_token: target.appToken,
      table_id: target.tableId,
    },
    data: {
      field_name: fieldName,
      type: fieldType,
      ...(property ? { property } : {}),
    },
  })) as LarkResponse<{ field?: BitableField }>;
  ensureLarkSuccess(response, "bitable.appTableField.create");
  return response.data?.field ?? { field_name: fieldName, type: TEXT_FIELD_TYPE };
}

async function listAllRecords(
  client: FeishuTaskControlClient,
  target: FeishuTaskControlSyncTarget,
): Promise<BitableRecord[]> {
  const records: BitableRecord[] = [];
  let pageToken: string | undefined;
  do {
    const response = (await client.bitable.appTableRecord.list({
      path: {
        app_token: target.appToken,
        table_id: target.tableId,
      },
      params: {
        page_size: 500,
        ...(pageToken ? { page_token: pageToken } : {}),
      },
    })) as LarkResponse<{
      items?: BitableRecord[];
      has_more?: boolean;
      page_token?: string;
    }>;
    ensureLarkSuccess(response, "bitable.appTableRecord.list");
    records.push(...(response.data?.items ?? []));
    pageToken = response.data?.has_more ? response.data.page_token : undefined;
  } while (pageToken);
  return records;
}

async function batchCreateRecords(
  client: FeishuTaskControlClient,
  target: FeishuTaskControlSyncTarget,
  records: Array<{ fields: Record<string, string | number> }>,
): Promise<void> {
  if (records.length === 0) {
    return;
  }
  const response = (await client.bitable.appTableRecord.batchCreate({
    path: {
      app_token: target.appToken,
      table_id: target.tableId,
    },
    data: { records },
  })) as LarkResponse;
  ensureLarkSuccess(response, "bitable.appTableRecord.batchCreate");
}

async function batchUpdateRecords(
  client: FeishuTaskControlClient,
  target: FeishuTaskControlSyncTarget,
  records: Array<{ record_id: string; fields: Record<string, string | number> }>,
): Promise<void> {
  if (records.length === 0) {
    return;
  }
  const response = (await client.bitable.appTableRecord.batchUpdate({
    path: {
      app_token: target.appToken,
      table_id: target.tableId,
    },
    data: { records },
  })) as LarkResponse;
  ensureLarkSuccess(response, "bitable.appTableRecord.batchUpdate");
}

async function listAllViews(
  client: FeishuTaskControlClient,
  target: FeishuTaskControlSyncTarget,
): Promise<BitableView[]> {
  const views: BitableView[] = [];
  let pageToken: string | undefined;
  do {
    const response = (await client.bitable.appTableView.list({
      path: {
        app_token: target.appToken,
        table_id: target.tableId,
      },
      params: {
        page_size: 500,
        ...(pageToken ? { page_token: pageToken } : {}),
      },
    })) as LarkResponse<{
      items?: BitableView[];
      has_more?: boolean;
      page_token?: string;
    }>;
    ensureLarkSuccess(response, "bitable.appTableView.list");
    views.push(...(response.data?.items ?? []));
    pageToken = response.data?.has_more ? response.data.page_token : undefined;
  } while (pageToken);
  return views;
}

async function createView(
  client: FeishuTaskControlClient,
  target: FeishuTaskControlSyncTarget,
  viewName: string,
): Promise<BitableView> {
  const response = (await client.bitable.appTableView.create({
    path: {
      app_token: target.appToken,
      table_id: target.tableId,
    },
    data: {
      view_name: viewName,
      view_type: "grid",
    },
  })) as LarkResponse<{ view?: BitableView }>;
  ensureLarkSuccess(response, "bitable.appTableView.create");
  return response.data?.view ?? { view_name: viewName };
}

async function patchView(
  client: FeishuTaskControlClient,
  target: FeishuTaskControlSyncTarget,
  viewId: string,
  data: NonNullable<
    Parameters<FeishuTaskControlClient["bitable"]["appTableView"]["patch"]>[0]
  >["data"],
): Promise<void> {
  const response = (await client.bitable.appTableView.patch({
    path: {
      app_token: target.appToken,
      table_id: target.tableId,
      view_id: viewId,
    },
    data,
  })) as LarkResponse;
  ensureLarkSuccess(response, "bitable.appTableView.patch");
}

function buildViewPatchData(params: {
  view: FeishuTaskControlView;
  fieldIdsByName: Map<string, string>;
  fieldsByName: Map<string, BitableField>;
  hiddenFieldNames: string[];
}) {
  const hiddenFieldIds = params.hiddenFieldNames
    .map((name) => params.fieldIdsByName.get(name))
    .filter((fieldId): fieldId is string => Boolean(fieldId));
  const marker = VIEW_FILTER_MARKERS[params.view.name as keyof typeof VIEW_FILTER_MARKERS];
  const filterFieldId = marker ? params.fieldIdsByName.get(marker.fieldName) : undefined;
  const markerField = marker ? params.fieldsByName.get(marker.fieldName) : undefined;
  const markerOptionId = markerField?.property?.options?.find(
    (option) => option.name === marker?.value && option.id?.trim(),
  )?.id;
  return {
    view_name: params.view.name,
    property: {
      ...(hiddenFieldIds.length > 0 ? { hidden_fields: hiddenFieldIds } : {}),
      ...(marker && filterFieldId
        ? {
            filter_info: {
              conjunction: "and" as const,
              conditions: [
                {
                  field_id: filterFieldId,
                  operator: "is" as const,
                  value: JSON.stringify([markerOptionId ?? marker.value]),
                },
              ],
            },
          }
        : {}),
    },
  };
}

export function createFeishuTaskControlClient(params: {
  cfg: OpenClawConfig;
  accountId?: string;
}): FeishuTaskControlClient {
  const account = resolveFeishuRuntimeAccount({
    cfg: params.cfg,
    accountId: normalizeOptional(params.accountId),
  });
  return createFeishuClient(account);
}

export async function syncTaskControlProjectionToFeishu(params: {
  cfg: OpenClawConfig;
  projection: FeishuTaskControlProjection;
  target: FeishuTaskControlSyncTarget;
  client?: FeishuTaskControlClient;
}): Promise<FeishuTaskControlSyncResult> {
  const uniqueFieldName = params.target.uniqueFieldName ?? DEFAULT_UNIQUE_FIELD_NAME;
  const client =
    params.client ??
    createFeishuTaskControlClient({
      cfg: params.cfg,
      accountId: params.target.accountId,
    });

  const existingFields = await listAllFields(client, params.target);
  const fieldIdsByName = new Map<string, string>();
  const fieldsByName = new Map<string, BitableField>();
  for (const field of existingFields) {
    if (field.field_name?.trim()) {
      fieldsByName.set(field.field_name, field);
    }
    if (field.field_name?.trim() && field.field_id?.trim()) {
      fieldIdsByName.set(field.field_name, field.field_id);
    }
  }

  const fieldsCreated: string[] = [];
  for (const field of params.projection.fields) {
    if (fieldIdsByName.has(field.key)) {
      continue;
    }
    const created = await createField(
      client,
      params.target,
      field.key,
      field.fieldType ?? TEXT_FIELD_TYPE,
      field.property,
    );
    if (created.field_name?.trim() && created.field_id?.trim()) {
      fieldIdsByName.set(created.field_name, created.field_id);
      fieldsByName.set(created.field_name, {
        ...(field.property ? { property: field.property as BitableField["property"] } : {}),
        ...created,
      });
    } else {
      fieldIdsByName.set(field.key, field.key);
      fieldsByName.set(field.key, {
        field_id: field.key,
        field_name: field.key,
        type: field.fieldType ?? TEXT_FIELD_TYPE,
        ...(field.property ? { property: field.property as BitableField["property"] } : {}),
      });
    }
    fieldsCreated.push(field.key);
  }

  if (fieldsCreated.length > 0) {
    fieldIdsByName.clear();
    fieldsByName.clear();
    for (const field of await listAllFields(client, params.target)) {
      if (field.field_name?.trim()) {
        fieldsByName.set(field.field_name, field);
      }
      if (field.field_name?.trim() && field.field_id?.trim()) {
        fieldIdsByName.set(field.field_name, field.field_id);
      }
    }
  }

  const existingRecords = await listAllRecords(client, params.target);
  const recordIdByTaskId = new Map<string, string>();
  for (const record of existingRecords) {
    const taskIdValue = record.fields?.[uniqueFieldName];
    const taskId =
      typeof taskIdValue === "string"
        ? taskIdValue.trim()
        : typeof taskIdValue === "number"
          ? String(taskIdValue)
          : "";
    if (taskId && record.record_id?.trim()) {
      recordIdByTaskId.set(taskId, record.record_id);
    }
  }

  let rowsCreated = 0;
  let rowsUpdated = 0;
  const createPayloads: Array<{ fields: Record<string, string | number> }> = [];
  const updatePayloads: Array<{ record_id: string; fields: Record<string, string | number> }> = [];
  for (const row of params.projection.rows) {
    const fields = Object.fromEntries(
      Object.entries(row.fields).map(([key, value]) => [key, toFieldPayloadValue(value)]),
    );
    const existingRecordId = recordIdByTaskId.get(row.taskId);
    if (existingRecordId) {
      updatePayloads.push({ record_id: existingRecordId, fields });
      continue;
    }
    createPayloads.push({ fields });
  }
  await batchCreateRecords(client, params.target, createPayloads);
  await batchUpdateRecords(client, params.target, updatePayloads);
  rowsCreated = createPayloads.length;
  rowsUpdated = updatePayloads.length;

  const hiddenFieldNames = params.projection.fields
    .filter((field) => field.hidden)
    .map((field) => field.key);
  const existingViews = await listAllViews(client, params.target);
  const viewIdByName = new Map<string, string>();
  for (const view of existingViews) {
    if (view.view_name?.trim() && view.view_id?.trim()) {
      viewIdByName.set(view.view_name, view.view_id);
    }
  }

  let viewsCreated = 0;
  let viewsUpdated = 0;
  for (const view of params.projection.views) {
    let viewId = viewIdByName.get(view.name);
    if (!viewId) {
      const created = await createView(client, params.target, view.name);
      viewId = created.view_id ?? created.view_name ?? view.name;
      viewIdByName.set(view.name, viewId);
      viewsCreated += 1;
    }
    if (viewId) {
      await patchView(
        client,
        params.target,
        viewId,
        buildViewPatchData({
          view,
          fieldIdsByName,
          fieldsByName,
          hiddenFieldNames,
        }),
      );
      viewsUpdated += 1;
    }
  }

  return {
    accountId: normalizeOptional(params.target.accountId) ?? "default",
    appToken: params.target.appToken,
    tableId: params.target.tableId,
    uniqueFieldName,
    fieldsCreated,
    rowsCreated,
    rowsUpdated,
    viewsCreated,
    viewsUpdated,
    totalRows: params.projection.rows.length,
    totalViews: params.projection.views.length,
  };
}
