# Feishu Five-Bot Native Memory Design

**Date:** 2026-03-14

## Goal

Keep five Feishu bots externally visible while adding a usable native memory system
for the one long-running work group. The system should let every bot recall
durable group knowledge without introducing a separate external memory service.

## Context

- The active Feishu topology already exposes five bot identities backed by five
  OpenClaw agents: Jarvis, Alpha, Watson, Athena, and Friday.
- There is one important long-lived Feishu group:
  `oc_82dd978138a0cde5864868c5b5b8e754`.
- Other Feishu groups, if they ever exist, are not important and do not need
  durable memory guarantees.
- The user explicitly chose to keep all five bots visible in the group instead of
  collapsing everything behind a single visible steward bot.

## Constraints

- Stay inside OpenClaw's native memory model for now.
- Do not introduce a cross-machine shared memory service yet.
- Preserve separate bot identities and separate per-agent session stores.
- Keep the design understandable enough to operate during the experimentation phase.

## Official Capability Boundaries

- OpenClaw memory is plain Markdown plus `memory_search`; default memory roots are
  per-agent workspace files such as `MEMORY.md` and `memory/YYYY-MM-DD.md`.
- Session transcript indexing is opt-in and isolated per agent.
- More-specific routing matches (`peer`) win over broader channel/account routing.
- `memorySearch.extraPaths` can extend the indexed corpus with shared Markdown
  outside the default workspace memory roots.

These boundaries come from OpenClaw's official docs:

- <https://docs.openclaw.ai/concepts/memory>
- <https://docs.openclaw.ai/cli/memory>
- <https://docs.openclaw.ai/concepts/multi-agent>

## Decision Summary

Do **not** introduce `*_core` agents. Keep the current five visible agents and
upgrade them directly.

The memory model will be:

1. **Shared long-term memory**
   A shared Markdown directory is indexed by all five agents via
   `memorySearch.extraPaths`.

2. **Per-agent local durable memory**
   Each agent keeps its own native workspace memory files and compaction-driven
   memory flush behavior.

3. **Per-agent transcript recall**
   Each agent enables session transcript indexing so it can recall the group's
   history from its own session store.

4. **Jarvis as curator**
   Jarvis is the only agent that promotes durable cross-group facts into the
   shared long-term memory file. Other agents may record candidate information in
   their own local memory, but they do not directly curate the shared canonical
   memory file.

## Architecture

### 1. Keep the existing five visible agents

Use the current agents and current `accountId -> agent` bindings. Do not add a
second layer of per-group `*_core` agents because there is no meaningful second
group to isolate against.

### 2. Add one shared Markdown memory directory

Create a shared directory under the OpenClaw state root, for example:

`~/.openclaw/shared-memory/feishu-main-group/`

Proposed contents:

- `GROUP_MEMORY.md`
  - Canonical long-term group memory.
  - Stable facts only.
  - Curated by Jarvis.

- Optional later:
  - `README.md` describing the scope and editing rules.
  - Additional small runbooks if the group develops stable operating procedures.

All five agents index this directory via `memorySearch.extraPaths`.

### 3. Preserve per-agent local memory

Keep each agent's existing workspace and native local memory files:

- `MEMORY.md`
- `memory/YYYY-MM-DD.md`

This keeps OpenClaw's native pre-compaction memory flush useful without forcing
all agents to write directly into a shared file.

### 4. Enable transcript recall on all five agents

For Jarvis, Alpha, Watson, Athena, and Friday:

- enable `memorySearch.experimental.sessionMemory`
- set `memorySearch.sources` to `["memory", "sessions"]`

This lets each bot recall the long-lived group's history from its own session
transcripts.

### 5. Retrieval order

When a bot needs historical context, the expected recall priority is:

1. current live session context
2. shared `GROUP_MEMORY.md`
3. the bot's own local `MEMORY.md`
4. the bot's own local daily memory files
5. the bot's own session transcripts

This order keeps durable curated facts ahead of noisy historical fragments.

## Write Policy

### Shared canonical memory

Only Jarvis updates `GROUP_MEMORY.md`.

Jarvis promotes facts into `GROUP_MEMORY.md` when they are:

- explicit user preferences
- durable project decisions
- stable machine/service topology facts
- repeated operational rules that remain valuable after the current day

### Per-agent local memory

All five agents keep their own native local memory behavior.

They may write to their own:

- workspace `MEMORY.md`
- workspace `memory/YYYY-MM-DD.md`

These files remain agent-local and are allowed to contain candidate durable facts,
intermediate summaries, or local working context.

### Anti-noise rules

Do not promote raw group chat dumps, transient errors, or secrets into
`GROUP_MEMORY.md`.

Examples that should **not** become shared canonical memory:

- raw stack traces
- transient one-off failures
- tokens, cookies, or credentials
- temporary states with no lasting relevance

## Why This Design

This is the highest-value native design for the current phase because it:

- preserves the user-facing five-bot experience
- avoids unnecessary `*_core` agent proliferation
- keeps transcript recall native and per-agent, which matches OpenClaw's model
- creates one shared long-term memory layer without requiring an external service
- avoids five agents concurrently rewriting the same canonical memory file

## Known Limitations

- Cross-agent episodic memory is still not truly unified; each bot recalls its own
  transcript history, not a single shared transcript database.
- If other groups later become active and noisy, transcript recall may eventually
  need stronger routing isolation or a real shared memory backend.
- Shared long-term memory consistency depends on Jarvis actually curating it.

## Non-Goals

- No external vector database or memory service.
- No cross-machine shared memory in this phase.
- No attempt to make all five bots behave like one merged persona.

## Implementation Notes

The follow-up implementation plan should modify the current OpenClaw config,
seed the shared memory directory, adjust agent instructions where needed, and
verify recall from at least two bots before rollout is considered complete.
