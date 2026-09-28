import { createFeishuBitableClient } from "../../../extensions/feishu/api.js";
import type { OpenClawConfig } from "../../config/config.js";
import {
  syncBitableProjectionToFeishu,
  type FeishuBitableClient,
  type FeishuBitableProjection,
  type FeishuBitableSyncResult,
} from "../feishu-bitable-sync.js";
import type { FeishuTaskControlProjection, FeishuTaskControlView } from "./types.js";

export type FeishuTaskControlClient = FeishuBitableClient;

export type FeishuTaskControlSyncTarget = {
  appToken: string;
  tableId: string;
  accountId?: string;
  uniqueFieldName?: string;
};

export type FeishuTaskControlSyncResult = Omit<FeishuBitableSyncResult, "rowKeyFieldName"> & {
  uniqueFieldName: string;
};

const DEFAULT_UNIQUE_FIELD_NAME = "Task ID";

function toTaskView(view: FeishuTaskControlView, hiddenFieldNames: string[]) {
  const filter =
    view.name === "异常"
      ? { fieldName: "异常视图", value: "异常" }
      : view.name === "今日队列"
        ? { fieldName: "今日队列视图", value: "今日队列" }
        : undefined;
  return {
    name: view.name,
    hiddenFieldNames,
    ...(filter ? { filter } : {}),
  };
}

function toGenericProjection(projection: FeishuTaskControlProjection): FeishuBitableProjection {
  const hiddenFieldNames = projection.fields
    .filter((field) => field.hidden)
    .map((field) => field.key);
  return {
    fields: projection.fields.map((field) => ({
      key: field.key,
      hidden: field.hidden,
      fieldType: field.fieldType,
      property: field.property,
    })),
    rows: projection.rows.map((row) => ({
      rowKey: row.taskId,
      fields: row.fields,
    })),
    views: projection.views.map((view) => toTaskView(view, hiddenFieldNames)),
  };
}

export function createFeishuTaskControlClient(params: {
  cfg: OpenClawConfig;
  accountId?: string;
}): FeishuTaskControlClient {
  return createFeishuBitableClient(params);
}

export async function syncTaskControlProjectionToFeishu(params: {
  cfg: OpenClawConfig;
  projection: FeishuTaskControlProjection;
  target: FeishuTaskControlSyncTarget;
  client?: FeishuTaskControlClient;
}): Promise<FeishuTaskControlSyncResult> {
  const uniqueFieldName = params.target.uniqueFieldName ?? DEFAULT_UNIQUE_FIELD_NAME;
  const result = await syncBitableProjectionToFeishu({
    projection: toGenericProjection(params.projection),
    target: {
      appToken: params.target.appToken,
      tableId: params.target.tableId,
      accountId: params.target.accountId,
      rowKeyFieldName: uniqueFieldName,
    },
    client:
      params.client ??
      createFeishuBitableClient({
        cfg: params.cfg,
        accountId: params.target.accountId,
      }),
  });
  const { rowKeyFieldName: _rowKeyFieldName, ...taskResult } = result;
  return {
    ...taskResult,
    uniqueFieldName,
  };
}
