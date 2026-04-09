# Task Orchestration MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a minimal SQLite-backed task orchestration layer inside the OpenClaw gateway so Jarvis-led multi-agent work can be recorded, dispatched, tracked, and queried without changing current Feishu-facing behavior.

**Architecture:** Keep the current `Jarvis -> specialist -> Jarvis` behavior and add a repo-native orchestration slice under the gateway. Persist business tasks in a dedicated SQLite database under the OpenClaw state dir, expose gateway RPC methods for `tasks.create`, `tasks.dispatch`, `tasks.result`, `tasks.get`, and `tasks.tree`, and reuse the existing `agent` gateway method for internal dispatch into target agent sessions.

**Tech Stack:** TypeScript, OpenClaw gateway server methods, `node:sqlite`, Vitest, existing session key/routing helpers

---

### Task 1: Define the gateway task protocol and write failing handler tests

**Files:**

- Create: `src/gateway/server-methods/tasks.test.ts`
- Modify: `src/gateway/server-methods-list.ts`
- Modify: `src/gateway/server-methods.ts`
- Modify: `src/gateway/protocol/schema.ts`
- Modify: `src/gateway/protocol/index.ts`
- Modify: `src/gateway/protocol/schema/protocol-schemas.ts`
- Modify: `src/gateway/protocol/schema/types.ts`
- Create: `src/gateway/protocol/schema/tasks.ts`

**Step 1: Write the failing tests**

Add gateway handler tests that define:

- `tasks.create` writes a `root_task_id == task_id` root task, routes `research` to `agent_athena`, and defaults `status=pending`
- `tasks.dispatch` resolves the target session key from the source session and target agent, invokes the existing `agent` handler, and updates the task to `dispatched`
- `tasks.result` marks a task `done`, stores result fields, and creates the next child task for `handoff_to_watson`
- `tasks.tree` returns the root task with ordered children

**Step 2: Run the targeted tests to confirm RED**

Run:

```bash
pnpm vitest run --config vitest.gateway.config.ts src/gateway/server-methods/tasks.test.ts
```

Expected:

- FAIL because the task protocol and handlers do not exist yet

**Step 3: Add protocol surface**

Define TypeBox schemas and AJV validators for:

- `TasksCreateParams`
- `TasksDispatchParams`
- `TasksResultParams`
- `TasksGetParams`
- `TasksTreeParams`

Add the new method names to the gateway method list and handler aggregation.

**Step 4: Re-run the targeted tests**

Run the same command and confirm the remaining failures are now implementation failures, not unknown-method or missing-validator failures.

**Step 5: Commit**

```bash
git add src/gateway/server-methods/tasks.test.ts src/gateway/server-methods-list.ts src/gateway/server-methods.ts src/gateway/protocol/schema.ts src/gateway/protocol/index.ts src/gateway/protocol/schema/protocol-schemas.ts src/gateway/protocol/schema/types.ts src/gateway/protocol/schema/tasks.ts docs/plans/2026-04-09-task-orchestration-mvp-implementation.md
git commit -m "feat: add task orchestration gateway protocol"
```

### Task 2: Add the SQLite task store and route-selection service

**Files:**

- Create: `src/tasks/store.ts`
- Create: `src/tasks/store.test.ts`
- Create: `src/tasks/types.ts`
- Create: `src/tasks/routing.ts`

**Step 1: Write the failing store tests**

Add store-level tests for:

- schema bootstrap on first open
- creating root and child tasks
- recording task events
- updating status, dispatch metadata, and results
- loading a task tree by `root_task_id`

Add routing tests for:

- explicit task type routing
- fallback of `mixed` and `summary` to `agent_jarvis`

**Step 2: Run the targeted tests to confirm RED**

Run:

```bash
pnpm vitest run --config vitest.unit.config.ts src/tasks/store.test.ts
```

Expected:

- FAIL because the store and routing modules do not exist yet

**Step 3: Implement the minimal SQLite store**

Use `node:sqlite` through the existing helper to create a dedicated DB under:

```text
<stateDir>/orchestrator/tasks.sqlite
```

Define tables:

- `tasks`
- `task_events`
- `task_handoffs`

Support:

- `createTask`
- `markDispatched`
- `completeTask`
- `appendEvent`
- `getTask`
- `getTaskTree`

**Step 4: Re-run the targeted tests**

Run the same command and confirm green.

**Step 5: Commit**

```bash
git add src/tasks/store.ts src/tasks/store.test.ts src/tasks/types.ts src/tasks/routing.ts
git commit -m "feat: add sqlite task orchestration store"
```

### Task 3: Implement gateway task handlers with real dispatch and handoff creation

**Files:**

- Create: `src/gateway/server-methods/tasks.ts`
- Modify: `src/gateway/server-methods/agent.ts`
- Modify: `src/gateway/server-methods/tasks.test.ts`
- Modify: `src/tasks/types.ts`
- Create: `src/tasks/session-target.ts`

**Step 1: Extend the failing handler tests**

Cover:

- target session derivation keeps the source session suffix while swapping the agent id
- dispatch persists `target_session_key` and `target_run_id`
- result callback creates a Watson child task for `handoff_to_watson`
- final `handoff_to_jarvis` creates a summary task under the same root

**Step 2: Run the gateway tests to confirm RED**

Run:

```bash
pnpm vitest run --config vitest.gateway.config.ts src/gateway/server-methods/tasks.test.ts
```

Expected:

- FAIL on missing dispatch/handoff behavior

**Step 3: Implement the minimal handlers**

Implement:

- `tasks.create`
- `tasks.dispatch`
- `tasks.result`
- `tasks.get`
- `tasks.tree`

For dispatch:

- derive the target session from the source session key and owner agent
- reuse the exported `agent` gateway handler with `deliver=false`
- persist the returned `runId`

For result callback:

- persist result fields
- create child tasks only for supported fixed actions:
  - `handoff_to_watson`
  - `handoff_to_alpha`
  - `handoff_to_jarvis`

**Step 4: Re-run the gateway tests**

Run the same command and confirm green.

**Step 5: Commit**

```bash
git add src/gateway/server-methods/tasks.ts src/gateway/server-methods/agent.ts src/gateway/server-methods/tasks.test.ts src/tasks/types.ts src/tasks/session-target.ts
git commit -m "feat: add task orchestration gateway handlers"
```

### Task 4: Verify the end-to-end targeted MVP behavior

**Files:**

- Test: `src/tasks/store.test.ts`
- Test: `src/gateway/server-methods/tasks.test.ts`

**Step 1: Run focused verification**

Run:

```bash
pnpm vitest run --config vitest.unit.config.ts src/tasks/store.test.ts
pnpm vitest run --config vitest.gateway.config.ts src/gateway/server-methods/tasks.test.ts
```

Expected:

- all targeted task orchestration tests pass

**Step 2: Spot-check the SQLite file path behavior**

Run:

```bash
OPENCLAW_STATE_DIR=/tmp/openclaw-task-mvp pnpm vitest run --config vitest.unit.config.ts src/tasks/store.test.ts
```

Expected:

- the DB is created under `/tmp/openclaw-task-mvp/orchestrator/tasks.sqlite`

**Step 3: Commit**

```bash
git add src/tasks/store.ts src/tasks/store.test.ts src/tasks/types.ts src/tasks/routing.ts src/tasks/session-target.ts src/gateway/server-methods/tasks.ts src/gateway/server-methods/tasks.test.ts src/gateway/server-methods-list.ts src/gateway/server-methods.ts src/gateway/protocol/schema.ts src/gateway/protocol/index.ts src/gateway/protocol/schema/protocol-schemas.ts src/gateway/protocol/schema/types.ts src/gateway/protocol/schema/tasks.ts docs/plans/2026-04-09-task-orchestration-mvp-implementation.md
git commit -m "feat: add sqlite task orchestration mvp"
```
