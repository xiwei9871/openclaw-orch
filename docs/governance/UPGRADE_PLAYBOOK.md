# Upgrade Playbook

## Goal

Upgrade `openclaw-orch` to new upstream OpenClaw versions without losing orchestration overlay behavior.

## Core Rule

Treat upstream and overlay as separate layers.

- upstream: execution runtime
- overlay: orchestration control plane and projections

Do not mix temporary upstream experiments into the long-lived overlay branch without review.

## Before Upgrading

1. Capture runtime baseline
   - export cron jobs
   - save task control snapshots
   - note active workspace path
   - note active provider policy

2. Confirm clean git state
   - no unrelated local changes
   - overlay branch is committed and pushed

3. Record current overlay surface
   - `src/tasks/control-plane/*`
   - `src/commands/tasks.ts`
   - `src/commands/tasks.test.ts`
   - `src/cli/program/register.status-health-sessions.ts`
   - `src/cli/program/register.status-health-sessions.test.ts`
   - any approved compatibility fixes outside those paths

## Upgrade Procedure

1. Sync upstream code into a dedicated integration branch

2. Reapply or rebase overlay commits

3. Re-run focused validation in this order:

```bash
pnpm tsgo
pnpm exec vitest run src/tasks/control-plane/model.test.ts src/tasks/control-plane/feishu-bitable.test.ts
pnpm exec vitest run src/commands/tasks.test.ts
pnpm exec vitest run src/cli/program/register.status-health-sessions.test.ts
```

4. Re-run live projection validation:

```bash
node --import tsx src/index.ts tasks control --json
node --import tsx src/index.ts tasks control \
  --sync-feishu \
  --account jarvis \
  --app-token <app_token> \
  --table-id <table_id>
```

5. Re-run live summary validation:

```bash
node --import tsx src/index.ts tasks control \
  --write-summary <path> \
  --send-feishu-summary \
  --summary-target <chat:...> \
  --summary-account jarvis
```

## Acceptance Gate

Do not mark the upgrade complete unless all of the following are true:

- `pnpm tsgo` passes
- focused orchestration tests pass
- Feishu Task_Control sync succeeds
- Jarvis summary file is written
- Jarvis summary Feishu send succeeds
- no new canonical orchestration store was introduced

## Runtime Regression Checks

After the upgrade, verify:

- task facts still come from task registry
- projection views still exist:
  - `总览`
  - `异常`
  - `今日队列`
  - `Agent 视图`
- summary still reaches the expected Feishu chat
- no path drift reappears

## Rollback

If upgrade validation fails:

1. Stop editing runtime configuration
2. Reset the integration branch to the previous known-good overlay commit
3. Keep any investigative notes out of the production overlay branch
4. Open a focused compatibility fix task instead of mixing unrelated repairs
