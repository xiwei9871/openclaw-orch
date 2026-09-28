import type * as Lark from "@larksuiteoapi/node-sdk";

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

export type FeishuBitableClient = Pick<Lark.Client, "bitable">;

export type FeishuBitableProjectionField = {
  key: string;
  hidden?: boolean;
  fieldType?: number;
  property?: Record<string, unknown>;
};

export type FeishuBitableProjectionRow = {
  rowKey: string;
  fields: Record<string, string | number | null>;
};

export type FeishuBitableProjectionView = {
  name: string;
  hiddenFieldNames?: string[];
  filter?: {
    fieldName: string;
    value: string;
  };
};

export type FeishuBitableProjection = {
  fields: FeishuBitableProjectionField[];
  rows: FeishuBitableProjectionRow[];
  views: FeishuBitableProjectionView[];
};

export type FeishuBitableSyncTarget = {
  appToken: string;
  tableId: string;
  accountId?: string;
  rowKeyFieldName: string;
};

export type FeishuBitableSyncResult = {
  accountId: string;
  appToken: string;
  tableId: string;
  rowKeyFieldName: string;
  fieldsCreated: string[];
  rowsCreated: number;
  rowsUpdated: number;
  viewsCreated: number;
  viewsUpdated: number;
  totalRows: number;
  totalViews: number;
};

const TEXT_FIELD_TYPE = 1;

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

function toFieldPayloadValue(value: string | number | null | undefined): string | number {
  return typeof value === "number" ? value : (value ?? "");
}

async function listAllFields(
  client: FeishuBitableClient,
  target: FeishuBitableSyncTarget,
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
  client: FeishuBitableClient,
  target: FeishuBitableSyncTarget,
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
  client: FeishuBitableClient,
  target: FeishuBitableSyncTarget,
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
  client: FeishuBitableClient,
  target: FeishuBitableSyncTarget,
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
  client: FeishuBitableClient,
  target: FeishuBitableSyncTarget,
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
  client: FeishuBitableClient,
  target: FeishuBitableSyncTarget,
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
  client: FeishuBitableClient,
  target: FeishuBitableSyncTarget,
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
  client: FeishuBitableClient,
  target: FeishuBitableSyncTarget,
  viewId: string,
  data: NonNullable<Parameters<FeishuBitableClient["bitable"]["appTableView"]["patch"]>[0]>["data"],
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
  view: FeishuBitableProjectionView;
  fieldIdsByName: Map<string, string>;
  fieldsByName: Map<string, BitableField>;
}) {
  const hiddenFieldIds = (params.view.hiddenFieldNames ?? [])
    .map((name) => params.fieldIdsByName.get(name))
    .filter((fieldId): fieldId is string => Boolean(fieldId));
  const filterFieldId = params.view.filter
    ? params.fieldIdsByName.get(params.view.filter.fieldName)
    : undefined;
  const filterField = params.view.filter
    ? params.fieldsByName.get(params.view.filter.fieldName)
    : undefined;
  const filterOptionId = filterField?.property?.options?.find(
    (option) => option.name === params.view.filter?.value && option.id?.trim(),
  )?.id;
  return {
    view_name: params.view.name,
    property: {
      ...(hiddenFieldIds.length > 0 ? { hidden_fields: hiddenFieldIds } : {}),
      ...(params.view.filter && filterFieldId
        ? {
            filter_info: {
              conjunction: "and" as const,
              conditions: [
                {
                  field_id: filterFieldId,
                  operator: "is" as const,
                  value: JSON.stringify([filterOptionId ?? params.view.filter.value]),
                },
              ],
            },
          }
        : {}),
    },
  };
}

export async function syncBitableProjectionToFeishu(params: {
  projection: FeishuBitableProjection;
  target: FeishuBitableSyncTarget;
  client: FeishuBitableClient;
}): Promise<FeishuBitableSyncResult> {
  const client = params.client;

  const existingFields = await listAllFields(client, params.target);
  const fieldIdsByName = new Map<string, string>();
  const fieldsByName = new Map<string, BitableField>();
  const indexFields = (fields: BitableField[]) => {
    for (const field of fields) {
      if (field.field_name?.trim()) {
        fieldsByName.set(field.field_name, field);
      }
      if (field.field_name?.trim() && field.field_id?.trim()) {
        fieldIdsByName.set(field.field_name, field.field_id);
      }
    }
  };
  indexFields(existingFields);

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
    indexFields(await listAllFields(client, params.target));
  }

  const existingRecords = await listAllRecords(client, params.target);
  const recordIdByRowKey = new Map<string, string>();
  for (const record of existingRecords) {
    const value = record.fields?.[params.target.rowKeyFieldName];
    const rowKey =
      typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
    if (rowKey && record.record_id?.trim()) {
      recordIdByRowKey.set(rowKey, record.record_id);
    }
  }

  const createPayloads: Array<{ fields: Record<string, string | number> }> = [];
  const updatePayloads: Array<{ record_id: string; fields: Record<string, string | number> }> = [];
  for (const row of params.projection.rows) {
    const fields = {
      ...Object.fromEntries(
        Object.entries(row.fields).map(([key, value]) => [key, toFieldPayloadValue(value)]),
      ),
      [params.target.rowKeyFieldName]: row.rowKey,
    };
    const existingRecordId = recordIdByRowKey.get(row.rowKey);
    if (existingRecordId) {
      updatePayloads.push({ record_id: existingRecordId, fields });
    } else {
      createPayloads.push({ fields });
    }
  }
  await batchCreateRecords(client, params.target, createPayloads);
  await batchUpdateRecords(client, params.target, updatePayloads);

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
        buildViewPatchData({ view, fieldIdsByName, fieldsByName }),
      );
      viewsUpdated += 1;
    }
  }

  return {
    accountId: normalizeOptional(params.target.accountId) ?? "default",
    appToken: params.target.appToken,
    tableId: params.target.tableId,
    rowKeyFieldName: params.target.rowKeyFieldName,
    fieldsCreated,
    rowsCreated: createPayloads.length,
    rowsUpdated: updatePayloads.length,
    viewsCreated,
    viewsUpdated,
    totalRows: params.projection.rows.length,
    totalViews: params.projection.views.length,
  };
}
