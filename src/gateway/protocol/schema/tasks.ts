import { Static, Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const TaskTypeSchema = Type.Union([
  Type.Literal("research"),
  Type.Literal("report"),
  Type.Literal("code"),
  Type.Literal("schedule"),
  Type.Literal("mixed"),
  Type.Literal("summary"),
]);

const TaskStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("dispatched"),
  Type.Literal("running"),
  Type.Literal("waiting"),
  Type.Literal("done"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);

const TaskSourceSchema = Type.Union([
  Type.Literal("feishu"),
  Type.Literal("tui"),
  Type.Literal("system"),
]);

export const TasksCreateParamsSchema = Type.Object(
  {
    source: TaskSourceSchema,
    sourceMessageId: Type.Optional(NonEmptyString),
    sourceSessionKey: Type.Optional(NonEmptyString),
    sourceUserId: Type.Optional(NonEmptyString),
    instruction: NonEmptyString,
    taskType: Type.Optional(TaskTypeSchema),
    parentTaskId: Type.Optional(NonEmptyString),
    rootTaskId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const TasksDispatchParamsSchema = Type.Object(
  {
    taskId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const TasksResultParamsSchema = Type.Object(
  {
    taskId: NonEmptyString,
    agentId: NonEmptyString,
    status: Type.Union([
      Type.Literal("done"),
      Type.Literal("failed"),
      Type.Literal("cancelled"),
      Type.Literal("waiting"),
      Type.Literal("running"),
    ]),
    resultSummary: Type.Optional(Type.String()),
    resultPayload: Type.Optional(Type.Any()),
    resultRef: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const TasksGetParamsSchema = Type.Object(
  {
    taskId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const TasksTreeParamsSchema = Type.Object(
  {
    taskId: NonEmptyString,
  },
  { additionalProperties: false },
);

export type GatewayTaskType = Static<typeof TaskTypeSchema>;
export type GatewayTaskStatus = Static<typeof TaskStatusSchema>;
