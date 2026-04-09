# Feishu Task Board Design

## Background

The repo now has a minimal SQLite-backed task orchestration MVP under `src/tasks/*` and `src/gateway/server-methods/tasks.ts`. That gives OpenClaw a task ledger, routing, dispatch, and tree queries, but it does not yet provide:

- a phone-friendly operator view
- durable task-state reporting in Chinese inside Feishu
- automatic repair when Feishu sync drifts from SQLite
- scheduled status summaries from Jarvis

The user explicitly chose this operating model:

- `SQLite` remains the single source of truth
- Feishu Bitable is a read-only mobile task board
- Feishu display should use Chinese labels
- Jarvis should send periodic task summaries

## Goals

- Keep task truth in the existing SQLite orchestration store
- Expose a read-only Feishu Bitable board that mirrors task state in Chinese
- Sync task changes close to real time without making task execution depend on Feishu availability
- Repair Feishu drift automatically with scheduled reconciliation
- Let Jarvis send concise Chinese status summaries for in-progress, waiting, done, and failed work

## Non-Goals

- Do not make Feishu Bitable the source of truth
- Do not support reverse edits from Feishu back into OpenClaw in v1
- Do not add a new web UI before the Bitable board works
- Do not introduce a second task engine or scheduler outside the existing gateway/cron stack
- Do not create per-status chat spam for every normal task transition

## Current Repo Context

The existing orchestration slice is already in place:

- `src/tasks/types.ts`
- `src/tasks/store.ts`
- `src/tasks/store.test.ts`
- `src/tasks/routing.ts`
- `src/gateway/server-methods/tasks.ts`

Current task persistence already stores:

- task identity and lineage
- source metadata
- routing owner
- status
- dispatch target session metadata
- result summary/payload/ref
- started/finished timestamps

The Feishu extension already contains Bitable support in:

- `extensions/feishu/src/bitable.ts`

The gateway already owns the runtime cron service in:

- `src/gateway/server-cron.ts`
- `src/cron/service.ts`

That means v1 should extend the current task store, reuse the existing cron service, and extract a reusable internal Feishu Bitable adapter rather than inventing new infrastructure.

## Architecture

The design is a single-direction operating chain:

`TaskStore (SQLite)` -> `task sync worker` -> `Feishu Bitable`

and a parallel notification chain:

`TaskStore (SQLite)` -> `Jarvis notifier` -> `Feishu group`

The Bitable board is presentation only. Task execution status is written to SQLite first and remains valid even if Feishu sync is down. Feishu write failures are tracked as sync errors, not task failures.

The synchronization model is hybrid:

- event-driven updates after task changes
- scheduled reconciliation via the existing cron service

This balances near-real-time updates with automatic drift repair.

## Data Model Changes

### Tasks Table

The existing `tasks` table should be extended with fields needed by the board and status summaries:

- `priority`
- `last_error`
- `next_action`
- `sync_state`
- `last_synced_at`
- `last_sync_error`

`sync_state` is board-specific state, not business task state. Recommended values:

- `pending`
- `synced`
- `sync_error`

The existing fields below remain the authoritative task lifecycle:

- `status`
- `owner_agent`
- `result_summary`
- `result_ref`
- `created_at`
- `updated_at`
- `started_at`
- `finished_at`

### Task Events Table

`task_events` remains append-only and gains new event types for board/notification operations:

- `sync_requested`
- `sync_succeeded`
- `sync_error`
- `notify_sent`
- `notify_error`

These events must never overwrite task business status.

## Feishu Bitable Mapping

The board is optimized for mobile reading, so it should show Chinese labels by default.

### Primary Display Columns

- `任务标题`
- `任务ID`
- `根任务ID`
- `父任务ID`
- `任务层级`
- `类型`
- `负责人`
- `状态`
- `优先级`
- `下一步`
- `结果摘要`
- `最近错误`
- `来源`
- `创建时间`
- `更新时间`
- `完成时间`
- `结果引用`

### Derived Chinese Display Rules

#### Owner Labels

- `agent_jarvis` -> `贾维斯`
- `agent_athena` -> `雅典娜`
- `agent_alpha` -> `阿尔法`
- `agent_watson` -> `沃森`
- `agent_friday` -> `星期五`

#### Status Labels

- `pending` -> `待处理`
- `dispatched` -> `已派发`
- `running` -> `进行中`
- `waiting` -> `等待中`
- `done` -> `已完成`
- `failed` -> `失败`
- `cancelled` -> `已取消`

#### Task Depth Labels

- root task -> `根任务`
- child of root -> `子任务`
- deeper descendants -> `孙任务`

### Hidden Raw Columns

To preserve operator/debug value, the sync layer may also maintain hidden raw fields:

- `status_raw`
- `owner_agent_raw`

Those are for troubleshooting and should not be the default mobile-facing fields.

## Event-Driven Sync

Feishu sync should run after these task events:

- task creation
- dispatch
- running/waiting transitions
- completion
- failure
- cancellation
- handoff creation

The order of operations is strict:

1. write task change to SQLite
2. append `task_events`
3. enqueue board sync

If Feishu write fails:

- keep the SQLite change
- mark `sync_state=sync_error`
- write `last_sync_error`
- append a `sync_error` event

This keeps execution truth separate from presentation reliability.

## Feishu Record Upsert Rules

Each `task_id` maps to exactly one Bitable record.

Recommended rules:

- if no record exists for `task_id`, create one
- if a record exists, update it in place
- child tasks are independent rows, linked through `root_task_id` and `parent_task_id`

The board must not create one row per status transition. It is a task board, not an audit log.

## Scheduled Reconciliation

The sync model is hybrid, so reconciliation is required.

### Incremental Reconcile

Run every 5 minutes through the existing gateway cron service.

Scope:

- tasks updated in the last 24 hours
- tasks whose `sync_state != synced`

### Full Reconcile

Run daily during a low-traffic window.

Scope:

- all board-managed tasks

### Reconcile Actions

- SQLite has task, Feishu missing row -> create row
- Feishu has row, SQLite missing task -> mark record as orphaned or add `最近错误=孤立记录`
- both exist but differ -> overwrite Feishu from SQLite
- prior sync failure -> retry and clear `last_sync_error` on success

Reconciliation always trusts SQLite.

## Jarvis Status Reporting

Jarvis should summarize state, not stream every ordinary transition.

### Immediate Notifications

Send immediately only for:

- failed tasks
- high-priority tasks that finish
- tasks that remain in `waiting` past a configured threshold

### Periodic Summaries

Run on a fixed interval through the cron service. Initial recommendation: every 2 hours.

Summary buckets:

- `进行中`
- `等待中`
- `已完成`
- `失败`

### Daily Rollup

Optional but recommended:

- new tasks today
- completed today
- failed today
- still blocked/waiting

### Noise Controls

- do not repeat unchanged task summaries inside a 30-minute suppression window
- non-priority completions roll into periodic summary only
- merge multiple failures into one digest when they happen close together

## Failure Isolation

This design separates three failure planes:

### Task Execution Failure

- task becomes `failed`
- `last_error` is updated
- board row shows `失败`
- Jarvis may notify immediately

### Board Sync Failure

- task business status does not change
- `sync_state` becomes `sync_error`
- `last_sync_error` is updated
- reconciliation retries later

### Notification Failure

- task business status does not change
- append `notify_error`
- next summary run may mention recovery

This is the key correctness rule for the feature: board/notification problems must never rewrite execution truth.

## Implementation Shape

Recommended module split:

- `src/tasks/store.ts`
  Extend task/task_event persistence and query helpers
- `src/tasks/board/*`
  Chinese label mapping, record shaping, Feishu board sync, reconciliation
- `src/tasks/notify/*`
  Jarvis summary generation and delivery
- `extensions/feishu/src/bitable-client.ts`
  Internal reusable Bitable CRUD adapter extracted from tool logic
- `src/gateway/server-cron.ts`
  Register reconciliation and notifier jobs through the existing cron runtime

This keeps task truth, Feishu sync, and notifications decoupled.

## Testing Strategy

The feature needs four layers of tests:

1. store tests

- verify new task fields and sync flags persist correctly

2. board sync tests

- verify Chinese field mapping
- verify upsert-by-`task_id`
- verify sync failures only affect sync metadata

3. reconciliation tests

- verify missing rows are recreated
- verify drift is repaired from SQLite
- verify orphan rows are flagged

4. notifier tests

- verify digest grouping
- verify failure immediate alerts
- verify duplicate suppression

Cron integration should be tested by wiring jobs through `buildGatewayCronService` rather than ad hoc timers.

## Rollout Plan

### Phase 1

- extend SQLite task model
- add sync metadata
- add internal Feishu board adapter

### Phase 2

- event-driven board sync
- 5-minute incremental reconciliation

### Phase 3

- Jarvis periodic summary
- failed-task immediate alerts

### Phase 4

- optional daily rollup
- operational tuning of thresholds and message templates

## Final Decision

The approved v1 design is:

- `SQLite` is the only source of truth
- Feishu Bitable is a Chinese read-only board
- board sync is event-driven with scheduled reconciliation
- Jarvis sends scheduled Chinese summaries and selective immediate alerts
- board and notify failures are isolated from real task status
