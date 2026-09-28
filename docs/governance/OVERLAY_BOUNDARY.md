# Overlay Boundary

## Purpose

This document defines what belongs in upstream OpenClaw versus what belongs in `openclaw-orch`.

The purpose is to keep future upstream upgrades manageable.

## Upstream Core

The following are treated as upstream execution core concerns:

- session runtime
- cron runtime
- background task execution
- task registry and task-flow registry
- provider auth/runtime internals
- channel transport and delivery internals

Changes to these areas should be minimal and only made when:

- an upstream bug blocks orchestration overlay behavior
- a compatibility seam is required
- a safety or correctness issue must be fixed

## Orchestration Overlay

The following belong in `openclaw-orch` as overlay concerns:

- `src/tasks/control-plane/*`
- Feishu Task_Control projection
- Jarvis summary projection
- orchestration policy docs
- provider selection policy above execution
- operator-facing governance docs

Overlay code must follow three rules:

1. Read facts from existing execution stores
2. Avoid creating a new canonical orchestration database
3. Treat every output as a projection or control artifact

## Allowed Coupling

Overlay code may read:

- `task-registry`
- `task-flow-registry`
- existing auth/profile state when needed for compatibility

Overlay code may not:

- replace the task registry as fact source
- add a second scheduler
- redefine task lifecycle outside existing runtime
- require Feishu success for execution success

## Legacy MVP Scope

The earlier `gateway/tasks + TaskStore` slice was useful as an MVP exploration, but it is not the long-term canonical architecture.

Going forward:

- keep it only where compatibility requires
- do not extend it as the primary orchestration path
- migrate orchestration features onto the control-plane model and existing task facts

## Review Checklist

Before merging any new orchestration change, confirm:

- Does it read from the task registry instead of inventing a new fact store?
- Does it avoid adding a new scheduler?
- Is Feishu or summary logic only a projection?
- Can this change be replayed cleanly after an upstream rebase?

If any answer is "no", the change is outside the intended overlay boundary.
