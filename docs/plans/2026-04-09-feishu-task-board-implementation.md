# Feishu Task Board Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Chinese read-only Feishu Bitable task board and Jarvis task-status summaries on top of the existing SQLite task orchestration ledger.

**Architecture:** Extend the current `src/tasks/*` task store with board-sync metadata, then add a repo-native Feishu board sync layer that upserts one Bitable row per `task_id`. Reuse the existing gateway cron runtime for 5-minute reconciliation and periodic Jarvis summaries so SQLite stays authoritative while Feishu remains a repaired presentation layer.

**Tech Stack:** TypeScript, `node:sqlite`, existing OpenClaw gateway task handlers, existing Feishu extension Bitable client, existing gateway cron service, Vitest

---

### Task 1: Extend the SQLite task model for board sync and operator-facing metadata

**Files:**

- Modify: `src/tasks/types.ts`
- Modify: `src/tasks/store.ts`
- Modify: `src/tasks/store.test.ts`

**Step 1: Write the failing tests**

Add store tests that define the new persisted task fields and sync metadata:

```ts
expect(task.priority).toBe("P1");
expect(task.lastError).toBe(null);
expect(task.nextAction).toBe(null);
expect(task.syncState).toBe("pending");
expect(task.lastSyncedAt).toBe(null);
expect(task.lastSyncError).toBe(null);
```

Also add a test that marks sync success and sync failure without changing the business task status.

**Step 2: Run test to verify it fails**

Run:

```bash
corepack pnpm vitest run --config vitest.unit.config.ts src/tasks/store.test.ts
```

Expected:

- FAIL because the new task fields and sync helpers do not exist yet

**Step 3: Write minimal implementation**

Update `src/tasks/types.ts` to add:

- `priority`
- `lastError`
- `nextAction`
- `syncState`
- `lastSyncedAt`
- `lastSyncError`

Update `src/tasks/store.ts` to:

- migrate `tasks` schema with the new columns
- allow `createTask()` defaults such as `priority="P1"` and `syncState="pending"`
- add explicit helpers such as:

```ts
markTaskStatus(...)
markTaskSyncSuccess(...)
markTaskSyncError(...)
```

Keep sync state separate from task business status.

**Step 4: Run test to verify it passes**

Run the same command and confirm green.

**Step 5: Commit**

```bash
git add src/tasks/types.ts src/tasks/store.ts src/tasks/store.test.ts
git commit -m "feat: extend task store for feishu board sync"
```

### Task 2: Extract an internal Feishu Bitable adapter and define Chinese board-field mapping

**Files:**

- Create: `extensions/feishu/src/bitable-client.ts`
- Create: `extensions/feishu/src/bitable-client.test.ts`
- Create: `src/tasks/board/labels.ts`
- Create: `src/tasks/board/feishu-board.ts`
- Create: `src/tasks/board/feishu-board.test.ts`
- Modify: `extensions/feishu/src/bitable.ts`

**Step 1: Write the failing tests**

Add tests that define:

- `taskId`-based record lookup/upsert behavior
- Chinese status labels:

```ts
expect(toTaskStatusZh("running")).toBe("进行中");
```

- Chinese owner labels:

```ts
expect(toTaskOwnerZh("agent_athena")).toBe("雅典娜");
```

- derived board payload fields:

```ts
expect(payload["状态"]).toBe("已完成");
expect(payload["负责人"]).toBe("贾维斯");
expect(payload["状态原值"]).toBe("done");
```

**Step 2: Run test to verify it fails**

Run:

```bash
corepack pnpm vitest run --config vitest.unit.config.ts extensions/feishu/src/bitable-client.test.ts src/tasks/board/feishu-board.test.ts
```

Expected:

- FAIL because the internal client and board shaper do not exist yet

**Step 3: Write minimal implementation**

Extract reusable Bitable CRUD from `extensions/feishu/src/bitable.ts` into an internal adapter that supports:

```ts
findRecordByTaskId(...)
createRecord(...)
updateRecord(...)
listRecords(...)
```

Create `src/tasks/board/labels.ts` for:

- owner Chinese labels
- status Chinese labels
- task-depth Chinese labels

Create `src/tasks/board/feishu-board.ts` to:

- map `TaskRecord` to Bitable row fields
- upsert one row per `task_id`
- keep hidden/raw fields for debugging

**Step 4: Run test to verify it passes**

Run the same command and confirm green.

**Step 5: Commit**

```bash
git add extensions/feishu/src/bitable-client.ts extensions/feishu/src/bitable-client.test.ts extensions/feishu/src/bitable.ts src/tasks/board/labels.ts src/tasks/board/feishu-board.ts src/tasks/board/feishu-board.test.ts
git commit -m "feat: add internal feishu bitable board adapter"
```

### Task 3: Wire event-driven board sync into task lifecycle updates

**Files:**

- Modify: `src/gateway/server-methods/tasks.ts`
- Create: `src/tasks/board/sync.ts`
- Create: `src/tasks/board/sync.test.ts`
- Modify: `src/tasks/store.ts`
- Modify: `src/tasks/types.ts`

**Step 1: Extend the failing tests**

Add tests that define:

- `tasks.create` requests board sync after SQLite write
- `tasks.dispatch` requests board sync after status update
- `tasks.result` requests board sync after completion or failure
- board sync failure marks only sync metadata, not task business status

Example assertion:

```ts
expect(updated.status).toBe("done");
expect(updated.syncState).toBe("sync_error");
expect(updated.lastSyncError).toContain("bitable");
```

**Step 2: Run test to verify it fails**

Run:

```bash
corepack pnpm vitest run --config vitest.gateway.config.ts src/gateway/server-methods/tasks.test.ts
corepack pnpm vitest run --config vitest.unit.config.ts src/tasks/board/sync.test.ts
```

Expected:

- FAIL because task handlers do not yet trigger board sync or isolate sync failures

**Step 3: Write minimal implementation**

Create `src/tasks/board/sync.ts` with a small orchestration function:

```ts
export async function syncTaskToFeishuBoard(taskId: string, deps: TaskBoardSyncDeps) {
  const task = deps.store.getTask(taskId);
  if (!task) return;
  try {
    await deps.board.upsertTask(task);
    deps.store.markTaskSyncSuccess(taskId);
  } catch (error) {
    deps.store.markTaskSyncError(taskId, String(error));
  }
}
```

Update `src/gateway/server-methods/tasks.ts` so `tasks.create`, `tasks.dispatch`, and `tasks.result` enqueue or invoke board sync after the SQLite write succeeds.

Ensure sync errors append `task_events` like `sync_error` and never rewrite the real task status.

**Step 4: Run test to verify it passes**

Run the same commands and confirm green.

**Step 5: Commit**

```bash
git add src/gateway/server-methods/tasks.ts src/tasks/board/sync.ts src/tasks/board/sync.test.ts src/tasks/store.ts src/tasks/types.ts
git commit -m "feat: sync task lifecycle into feishu board"
```

### Task 4: Add reconciliation and Jarvis summary jobs through the gateway cron service

**Files:**

- Create: `src/tasks/board/reconcile.ts`
- Create: `src/tasks/board/reconcile.test.ts`
- Create: `src/tasks/notify/jarvis-status.ts`
- Create: `src/tasks/notify/jarvis-status.test.ts`
- Modify: `src/gateway/server-cron.ts`
- Modify: `src/gateway/server-cron.test.ts`

**Step 1: Write the failing tests**

Add tests that define:

- incremental reconcile job scans recently changed tasks and repairs missing/drifted rows
- orphan board rows are flagged rather than treated as valid tasks
- Jarvis summary groups tasks by Chinese status bucket
- immediate failure notification is emitted for failed tasks
- duplicate notifications are suppressed inside the configured cooldown window

Example summary assertion:

```ts
expect(summary).toContain("进行中：2 项");
expect(summary).toContain("失败：1 项");
```

**Step 2: Run test to verify it fails**

Run:

```bash
corepack pnpm vitest run --config vitest.gateway.config.ts src/gateway/server-cron.test.ts
corepack pnpm vitest run --config vitest.unit.config.ts src/tasks/board/reconcile.test.ts src/tasks/notify/jarvis-status.test.ts
```

Expected:

- FAIL because the board reconcile/notifier jobs are not registered yet

**Step 3: Write minimal implementation**

Create `src/tasks/board/reconcile.ts` with:

- recent-task scan for 5-minute incremental repair
- full sweep helper for daily repair
- SQLite-authoritative overwrite behavior

Create `src/tasks/notify/jarvis-status.ts` with:

- summary builder for `进行中 / 等待中 / 已完成 / 失败`
- immediate failure alert formatter
- cooldown suppression state

Update `src/gateway/server-cron.ts` to register repo-native jobs using the existing `CronService`, not manual timers.

Initial cadence:

- reconcile: every 5 minutes
- Jarvis summary: every 2 hours

**Step 4: Run test to verify it passes**

Run the same commands and confirm green.

**Step 5: Commit**

```bash
git add src/tasks/board/reconcile.ts src/tasks/board/reconcile.test.ts src/tasks/notify/jarvis-status.ts src/tasks/notify/jarvis-status.test.ts src/gateway/server-cron.ts src/gateway/server-cron.test.ts
git commit -m "feat: add task board reconcile and jarvis summaries"
```

### Task 5: Verify the integrated board-sync MVP

**Files:**

- Test: `src/tasks/store.test.ts`
- Test: `src/tasks/board/feishu-board.test.ts`
- Test: `src/tasks/board/sync.test.ts`
- Test: `src/tasks/board/reconcile.test.ts`
- Test: `src/tasks/notify/jarvis-status.test.ts`
- Test: `src/gateway/server-methods/tasks.test.ts`
- Test: `src/gateway/server-cron.test.ts`

**Step 1: Run focused verification**

Run:

```bash
corepack pnpm vitest run --config vitest.unit.config.ts src/tasks/store.test.ts src/tasks/board/feishu-board.test.ts src/tasks/board/sync.test.ts src/tasks/board/reconcile.test.ts src/tasks/notify/jarvis-status.test.ts
corepack pnpm vitest run --config vitest.gateway.config.ts src/gateway/server-methods/tasks.test.ts src/gateway/server-cron.test.ts
```

Expected:

- all new board-sync and notifier tests pass

**Step 2: Run one store-path spot check**

Run:

```bash
OPENCLAW_STATE_DIR=/tmp/openclaw-task-board corepack pnpm vitest run --config vitest.unit.config.ts src/tasks/store.test.ts
```

Expected:

- the task DB still initializes under `/tmp/openclaw-task-board/orchestrator/tasks.sqlite`

**Step 3: Manually spot-check Chinese field output**

Run a focused test or helper assertion that verifies fields such as:

```ts
"状态" === "进行中";
"负责人" === "雅典娜";
```

Expected:

- the default board payload is Chinese-first and still retains hidden raw values

**Step 4: Commit**

```bash
git add src/tasks/store.test.ts src/tasks/board/feishu-board.test.ts src/tasks/board/sync.test.ts src/tasks/board/reconcile.test.ts src/tasks/notify/jarvis-status.test.ts src/gateway/server-methods/tasks.test.ts src/gateway/server-cron.test.ts docs/plans/2026-04-09-feishu-task-board-design.md docs/plans/2026-04-09-feishu-task-board-implementation.md
git commit -m "feat: add feishu task board sync and status summaries"
```
