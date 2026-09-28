# OpenClaw Remediation Plan v1.1

## Goal

This plan formalizes `openclaw-orch` as the orchestration overlay repository on top of upstream OpenClaw.

The goal is not to replace OpenClaw execution. The goal is to:

- keep OpenClaw runtime as the execution plane
- keep task registry / run store as the canonical fact source
- keep Feishu boards and Jarvis summaries as projections
- remove path drift, workspace drift, and orchestration coupling
- preserve upgradeability to future upstream OpenClaw versions

## Governance Principles

1. Single Source of Truth
   Task facts come from OpenClaw background tasks and task-flow state.

2. Control / Execution / Projection separation
   Control Plane reads and aggregates. Execution Plane runs work. Projection Plane renders views and notifications.

3. No New Scheduler
   All automation must reuse existing OpenClaw cron/runtime.

4. No Sidecar Canonical Store
   SQLite sidecars may be used for cache or tooling, never as the main fact source for orchestration.

5. Path Governance First
   No new hardcoded `/home/node` or ad-hoc workspace paths may enter the repository.

6. Changes Must Be Reversible
   Inventory first, migrate second, prune last.

## Current Baseline

The following is already in place and should be treated as the v1.1 starting point:

- Task Control Plane in `src/tasks/control-plane/*`
- `tasks control` CLI surface in `src/commands/tasks.ts`
- Feishu Task_Control projection and live Bitable sync
- Jarvis summary file and Feishu summary delivery

These are overlays on top of the existing task registry. They are not a replacement execution engine.

## Repository Roles

- `openclaw`
  Upstream runtime core.

- `openclaw-orch`
  Orchestration overlay repository.
  Owns:
  - task control plane
  - projection logic
  - orchestration policy
  - integration docs
  - upgrade playbooks

## Execution Order

### Phase A: Boundary Closure

- keep `src/tasks/control-plane/*` as the orchestration read model surface
- do not add a second canonical task store
- treat legacy `gateway/tasks + TaskStore` MVP code as compatibility / cleanup scope, not the future architecture

### Phase B: Inventory

Produce the following inventories before any destructive migration:

- workspace inventory
- cron inventory
- path inventory
- provider inventory

Recommended output location:

- `~/.openclaw/shared/reports/system_inventory/workspaces.json`
- `~/.openclaw/shared/reports/system_inventory/cron_jobs.json`
- `~/.openclaw/shared/reports/system_inventory/path_references.json`
- `~/.openclaw/shared/reports/system_inventory/provider_routes.json`

### Phase C: Path and Workspace Closure

- add a single path resolver module for OpenClaw home, state, and workspace paths
- remove `/home/node` assumptions
- converge active runtime onto the main Feishu workspace
- do not bulk-delete or bulk-move legacy workspaces until all references are proven inactive

### Phase D: Cron Closure

- export all cron jobs before modification
- normalize path references in cron payloads
- split board data sync and notify logic
- reuse `tasks control` commands from cron instead of inventing new scheduler code

### Phase E: Provider Closure

- define provider policy by tier: `primary`, `fallback`, `experimental`
- attach task classes or agent roles to policy tiers
- do not change global provider merge behavior until routing policy is observable

### Phase F: Agent Governance

Core long-lived roles remain:

- `agent_tui`
- `agent_jarvis`
- `agent_alpha`
- `agent_watson`
- `agent_athena`
- `agent_friday`

Add agent health projection on top of task facts instead of maintaining a separate agent health source.

### Phase G: Security Closure

- keep `exec` approval gated
- tighten owner-scoped visibility first
- do not globally disable agent-to-agent or force local-only bind without dependency inventory

## Phase 3 Definition: Jarvis Summary

Jarvis summary is a projection, not a scheduler and not a new fact store.

Inputs:

- task catalog
- task snapshot
- task ledger
- health model
- error classification

Outputs:

- markdown file
- Feishu text delivery

Canonical command:

```bash
node --import tsx src/index.ts tasks control \
  --write-summary <path> \
  --send-feishu-summary \
  --summary-target <chat:...> \
  --summary-account jarvis
```

## Acceptance Criteria

### P0

- Control Plane exists and reads only from task registry / task-flow
- orchestration overlays live in `openclaw-orch`

### P1

- no `/home/node` path drift remains
- active runtime paths resolve through a single resolver layer
- cron payloads are normalized
- board sync and notification are decoupled

### P2

- provider routing is explicit and explainable
- agent health is observable from control-plane outputs
- safety defaults are tightened without breaking current automation

### Final

- Feishu Task_Control full sync succeeds
- 4 views exist and remain patchable
- Jarvis summary can be rebuilt from task facts
- no projection layer is treated as canonical state
