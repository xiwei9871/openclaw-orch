# Feishu Five-Bot Native Memory Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a native shared long-term memory layer plus per-agent transcript recall for the five visible Feishu bots without introducing `*_core` agents or an external memory service.

**Architecture:** Keep the existing five agents and bindings, enable per-agent `sessionMemory`, and point all five agents at one shared Markdown memory directory through `memorySearch.extraPaths`. Jarvis becomes the curator of shared canonical memory while the other agents keep using their local workspace memory for candidate facts and daily context.

**Tech Stack:** OpenClaw Gateway, `memory-core`, Feishu channel bindings, Markdown memory files, Docker Compose deployment

---

### Task 1: Capture the Baseline and Back Up Config

**Files:**
- Modify: `/home/manqiao/.openclaw/openclaw.json`
- Create: `/home/manqiao/.openclaw/openclaw.json.bak-<timestamp>`

**Step 1: Record the current five-agent routing and memory state**

Run:

```bash
docker exec -i openclaw-openclaw-gateway-1 openclaw plugins list
docker exec -i openclaw-openclaw-gateway-1 openclaw hooks list
rg -n '"id": "agent_(jarvis|alpha|watson|athena|friday)"|"memorySearch"| "bindings"' /home/manqiao/.openclaw/openclaw.json
```

Expected:
- `memory-core` loaded
- current agent IDs and bindings visible
- no per-agent `sessionMemory` / shared `extraPaths` overrides yet

**Step 2: Back up the live config**

Run:

```bash
cp /home/manqiao/.openclaw/openclaw.json /home/manqiao/.openclaw/openclaw.json.bak-20260314T<HHMMSS>
```

Expected:
- backup file exists beside the active config

**Step 3: Commit checkpoint note (optional shell history marker)**

No git commit yet because this task only affects host runtime state.

### Task 2: Seed Shared Long-Term Memory Files

**Files:**
- Create: `/home/manqiao/.openclaw/shared-memory/feishu-main-group/GROUP_MEMORY.md`
- Create: `/home/manqiao/.openclaw/shared-memory/feishu-main-group/README.md`

**Step 1: Create the shared memory directory**

Run:

```bash
mkdir -p /home/manqiao/.openclaw/shared-memory/feishu-main-group
```

Expected:
- directory exists on the host and is visible in the container as `/home/node/.openclaw/shared-memory/feishu-main-group`

**Step 2: Write a minimal canonical memory file**

Create `/home/manqiao/.openclaw/shared-memory/feishu-main-group/GROUP_MEMORY.md` with:

```md
# Group Memory

## User Preferences

## Group Mission

## Project Decisions

## Environment Facts

## Operating Rules

## Verification Seed

MEMORY_TEST_SEED_20260314
```

**Step 3: Write a short README describing scope**

Create `/home/manqiao/.openclaw/shared-memory/feishu-main-group/README.md` with:

```md
# Feishu Main Group Shared Memory

This directory stores shared long-term memory for the main Feishu work group.
Jarvis curates GROUP_MEMORY.md. Other agents keep local daily memory and may
surface candidate durable facts for Jarvis to promote.
```

**Step 4: Verify the files exist**

Run:

```bash
ls -la /home/manqiao/.openclaw/shared-memory/feishu-main-group
```

Expected:
- `GROUP_MEMORY.md` and `README.md` both exist

**Step 5: Commit**

Skip git commit because these files live outside the repo.

### Task 3: Enable Shared Memory Search and Session Recall for the Five Agents

**Files:**
- Modify: `/home/manqiao/.openclaw/openclaw.json`

**Step 1: Add per-agent memory overrides**

For each of these agent entries inside `/home/manqiao/.openclaw/openclaw.json`:

- `agent_jarvis`
- `agent_alpha`
- `agent_watson`
- `agent_athena`
- `agent_friday`

add a `memorySearch` block like:

```json
"memorySearch": {
  "experimental": { "sessionMemory": true },
  "sources": ["memory", "sessions"],
  "extraPaths": ["/home/node/.openclaw/shared-memory/feishu-main-group"]
}
```

**Step 2: Verify the config diff is scoped**

Run:

```bash
git -C /home/manqiao/openclaw diff --no-index -- /home/manqiao/.openclaw/openclaw.json.bak-20260314T<HHMMSS> /home/manqiao/.openclaw/openclaw.json
```

Expected:
- only the five targeted agent blocks change
- no unrelated global memory settings are modified

**Step 3: Restart the gateway**

Run:

```bash
docker restart openclaw-openclaw-gateway-1
```

Expected:
- container returns to `running` / `healthy`

**Step 4: Force indexing for Jarvis**

Run:

```bash
docker exec -i openclaw-openclaw-gateway-1 openclaw memory index --agent agent_jarvis --force --verbose
```

Expected:
- indexing completes without config or provider errors

**Step 5: Verify shared memory recall from Jarvis and Alpha**

Run:

```bash
docker exec -i openclaw-openclaw-gateway-1 openclaw memory search --agent agent_jarvis --query "MEMORY_TEST_SEED_20260314" --json
docker exec -i openclaw-openclaw-gateway-1 openclaw memory search --agent agent_alpha --query "MEMORY_TEST_SEED_20260314" --json
```

Expected:
- both commands return at least one hit sourced from the shared memory directory

**Step 6: Commit**

No git commit yet because this task only affects runtime config outside the repo.

### Task 4: Add Memory Behavior Rules to the Five Agent Workspaces

**Files:**
- Modify: `/home/manqiao/.openclaw/workspace-jarvis/AGENTS.md`
- Modify: `/home/manqiao/.openclaw/workspace-alpha/AGENTS.md`
- Modify: `/home/manqiao/.openclaw/workspace-watson/AGENTS.md`
- Modify: `/home/manqiao/.openclaw/workspace-athena/AGENTS.md`
- Modify: `/home/manqiao/.openclaw/workspace-friday/AGENTS.md`

**Step 1: Add Jarvis shared-memory curator rules**

Update `/home/manqiao/.openclaw/workspace-jarvis/AGENTS.md` so Jarvis:

- reads shared `GROUP_MEMORY.md` before answering history-sensitive questions
- curates shared durable facts into `GROUP_MEMORY.md`
- keeps raw or transient notes out of shared canonical memory

**Step 2: Add non-Jarvis shared-memory usage rules**

Update the other four `AGENTS.md` files so they:

- treat shared `GROUP_MEMORY.md` as the canonical cross-bot memory
- keep candidate durable facts in local memory first
- avoid editing `GROUP_MEMORY.md` directly unless explicitly instructed

**Step 3: Verify the files contain the new rules**

Run:

```bash
rg -n "GROUP_MEMORY|shared memory|canonical" /home/manqiao/.openclaw/workspace-jarvis/AGENTS.md /home/manqiao/.openclaw/workspace-alpha/AGENTS.md /home/manqiao/.openclaw/workspace-watson/AGENTS.md /home/manqiao/.openclaw/workspace-athena/AGENTS.md /home/manqiao/.openclaw/workspace-friday/AGENTS.md
```

Expected:
- all five files mention the new shared-memory behavior

**Step 4: Commit**

No git commit yet because these files live outside the repo.

### Task 5: Verify Memory Behavior End-to-End

**Files:**
- Read: `/home/manqiao/.openclaw/shared-memory/feishu-main-group/GROUP_MEMORY.md`
- Read: `/home/manqiao/.openclaw/workspace-jarvis/AGENTS.md`
- Read: `/home/manqiao/.openclaw/workspace-alpha/AGENTS.md`

**Step 1: Reindex a second agent**

Run:

```bash
docker exec -i openclaw-openclaw-gateway-1 openclaw memory index --agent agent_alpha --force --verbose
```

Expected:
- second agent also indexes successfully

**Step 2: Verify the gateway is healthy**

Run:

```bash
docker inspect -f 'status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restartCount={{.RestartCount}}' openclaw-openclaw-gateway-1
```

Expected:
- `status=running`
- `health=healthy`

**Step 3: Manual live smoke test in Feishu**

Manual action:
- In the main Feishu group, tell Jarvis a clearly durable fact such as
  `记住：本群的长期协作原则是先写设计再改配置。`
- Confirm Jarvis records it into shared canonical memory or local durable memory
  according to the new rule.
- Ask Alpha or Watson later:
  `你记得本群的长期协作原则吗？`

Expected:
- the second bot can recall the principle via shared memory

**Step 4: Commit checkpoint in the repo for plan/doc updates**

Run:

```bash
git -C /home/manqiao/openclaw add docs/plans/2026-03-14-feishu-five-bot-native-memory-implementation.md
git -C /home/manqiao/openclaw commit -m "docs: add five-bot native memory implementation plan"
```

Expected:
- plan document committed without touching unrelated files like `docker-compose.yml`
