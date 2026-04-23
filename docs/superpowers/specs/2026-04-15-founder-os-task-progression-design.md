# Founder OS Cron Upgrade To Task Progression System

Date: 2026-04-15
Status: Draft for review
Scope: Founder OS business cron design on top of the current stable 7-cron baseline

## 1. Goal

Upgrade Founder OS from a "scheduled report generation system" into a "task progression system" without immediately expanding runtime complexity.

This design assumes the current runtime baseline is already stable:

- `founder-os-athena-daily-tech` is green
- `founder-os-friday-morning-priority` is green
- `founder-os-jarvis-morning-brief` is green
- `founder-os-friday-blockers` is green
- `founder-os-watson-content-summary` is green
- `founder-os-jarvis-evening-review` is green
- `founder-os-watson-weekly-tech-digest` is green

This design does not reopen completed infrastructure work:

- no control-plane redesign
- no cron path repair redesign
- no dashboard sync redesign
- no new provider/auth redesign

## 2. Operating Principles

### 2.1 Keep the current 7-cron baseline

Phase 1 must reuse the current 7 business cron jobs. The system should first learn to close loops with existing jobs before adding new ones.

### 2.2 File outputs remain the system contract

Business success is defined by structured file outputs, not by message delivery. `delivery.mode = none` remains the default contract.

### 2.3 Promote structured handoffs over repeated raw re-reading

Upstream jobs should generate structured artifacts. Downstream jobs should consume those artifacts instead of repeatedly scanning raw notes, meetings, or idea pools.

### 2.4 Jarvis is not the CEO

Jarvis should not be modeled as the founder's strategic mind. Jarvis is better defined as:

- COO
- Chief of Staff
- decision coordinator
- progression reviewer

Strategic intent must live outside Jarvis in a shared system file.

### 2.5 Strategy anchor must be explicit

All agents should read a shared goal file:

- `~/.openclaw/shared/founder-os/founder_goal.md`

This file becomes the stable top-level business context for Athena, Friday, Jarvis, Watson, and Alpha.

## 3. Target System Shape

Founder OS should be understood as five layers:

1. Sensing
   Athena scans external signals and technology developments.
2. Decision shaping
   Friday converts raw signal plus task state into actionable priority choices.
3. Management synthesis
   Jarvis converts structured upstream files into decisions, delegation, and progression summaries.
4. Execution support
   Watson and Alpha produce reusable output artifacts or execution work.
5. System substrate
   OpenClaw cron, task control, launch agents, scripts, and health reporting keep the system moving.

The key shift is:

`signal -> action recommendation -> priority -> progression check -> review`

instead of:

`signal -> report -> another report -> another report`

## 4. Current 7-Cron Role Map

### 4.1 Athena

Job:

- `founder-os-athena-daily-tech`

Role:

- external sensing
- signal extraction
- technology implication framing

Primary outputs:

- `daily_tech_report.md`
- `archive/daily_tech/YYYY-MM-DD.md`

Required upgrade in Phase 1:

- each top signal must explicitly include:
  - what changed
  - why it matters
  - recommended action or watch status

### 4.2 Friday

Jobs:

- `founder-os-friday-morning-priority`
- `founder-os-friday-blockers`

Role:

- task operations
- priority queue shaping
- blocker visibility

Primary outputs:

- `daily_priority.md`
- `task_blockers.md`
- updated `task_list.md`

Required upgrade in Phase 1:

- `morning-priority` must explicitly absorb upstream opportunity/action recommendations
- `blockers` must distinguish:
  - real blocker
  - high-risk but not blocked
  - escalation candidate

### 4.3 Jarvis

Jobs:

- `founder-os-jarvis-morning-brief`
- `founder-os-jarvis-evening-review`

Role:

- management synthesis
- decision queue shaping
- delegation guidance
- progression review

Primary outputs:

- `founder_morning_brief.md`
- `founder_evening_review.md`

Required upgrade in Phase 1:

- `morning-brief` must answer:
  - what needs decision today
  - what needs delegation today
  - what should be watched but not acted on
- `evening-review` must answer:
  - what actually progressed today
  - what did not progress and why
  - what becomes tomorrow's minimum next move

### 4.4 Watson

Jobs:

- `founder-os-watson-content-summary`
- `founder-os-watson-weekly-tech-digest`

Role:

- reusable knowledge packaging
- content condensation
- weekly synthesis

Primary outputs:

- `content_summary.md`
- `weekly_tech_digest.md`

Required upgrade in Phase 1:

- `content-summary` should emphasize reusable frameworks, templates, and distilled talking points
- `weekly-tech-digest` should remain a synthesis layer, not a second daily-tech run

## 5. Jarvis Final Positioning

Jarvis should be the management operating layer, not the strategic source of truth.

Jarvis responsibilities:

- read only structured upstream files
- maintain a decision queue for the founder
- suggest delegation targets
- detect lack of task progression
- summarize contradiction or uncertainty across upstream sources

Jarvis should not:

- become the only holder of founder intent
- repeatedly scan raw meeting notes or idea pools
- function as a general "smart router" for all work
- replace Friday's task-operations role

## 6. Phase 1: Upgrade To A Task Progression System Without Adding Cron

Phase 1 is the recommended implementation scope.

### 6.1 Add a shared strategy file

Create:

- `~/.openclaw/shared/founder-os/founder_goal.md`

Contents should include:

- current strategic goals
- current top priorities
- current constraints
- current "do not optimize for" list

All business agents read this file.

### 6.2 Extend Athena from signal reporting to action recommendation

`founder-os-athena-daily-tech` should continue producing a daily report, but each top signal must include one of:

- `act now`
- `watch`
- `ignore`

This is not task creation yet. It is action recommendation.

### 6.3 Make Friday morning-priority the first action gate

`founder-os-friday-morning-priority` becomes the first place where signals turn into task handling decisions.

For each relevant upstream signal or pending item, Friday should classify it as:

- enter today's priority list
- keep in watch state
- defer
- reject

This allows opportunity triage without adding a new cron in Phase 1.

### 6.4 Make Jarvis morning-brief the decision surface

`founder-os-jarvis-morning-brief` becomes the founder-facing management surface:

- top priorities
- decision queue
- delegation plan
- key risks

It should not create new raw facts. It should organize already-structured inputs into management choices.

### 6.5 Make Friday blockers and Jarvis evening-review the progression loop

`founder-os-friday-blockers` identifies operational blockers and risk levels.

`founder-os-jarvis-evening-review` becomes the daily progression check by answering:

- what advanced today
- what did not advance
- why not
- what is the smallest valid next move tomorrow

This creates progression checking without a dedicated `progress-check` cron.

### 6.6 Keep Watson as condensation, not orchestration

Watson should continue packaging reusable knowledge. It should not be upgraded into a scheduler or business operator.

## 7. Phase 1 Deliverables

Phase 1 should produce:

- a shared `founder_goal.md`
- prompt upgrades for Athena, Friday, and Jarvis
- a role map showing which file each cron reads and writes
- explicit decision/action categories embedded into existing outputs

Phase 1 should not produce:

- new cron jobs
- event-driven orchestration
- new infrastructure services
- hard coupling to Feishu or announce delivery

## 8. Phase 2: Future Cron Additions, Not For Immediate Implementation

These are allowed in the roadmap but should be marked deferred.

### 8.1 `founder-os-jarvis-opportunity-triage`

Purpose:

- split signal triage from morning priority only if signal volume becomes too large

Trigger condition:

- `daily_tech_report.md` regularly contains more opportunity candidates than Friday morning-priority can absorb cleanly

### 8.2 `founder-os-jarvis-progress-check`

Purpose:

- midday progression verification

Trigger condition:

- evening-review is too late to catch stalled work and same-day recovery becomes valuable

### 8.3 `founder-os-jarvis-weekly-opportunity-review`

Purpose:

- convert weekly signal accumulation into strategic shortlists

Trigger condition:

- daily signal handling works, but weekly pattern recognition is missing

### 8.4 `founder-os-watson-output-review`

Purpose:

- quality audit for generated outputs

Trigger condition:

- output quality drift becomes a real operational problem, not just a theoretical concern

## 9. Explicit Non-Goals

This design does not do the following now:

- treat Jarvis as the founder
- rebuild Founder OS into an event bus
- replace file-based handoffs with a database
- make every job depend on Feishu delivery
- expand the system simply because expansion sounds strategic

## 10. Recommended Next Implementation Order

1. Add `founder_goal.md`
2. Upgrade Athena prompt to emit action categories
3. Upgrade Friday morning-priority to absorb those categories into task decisions
4. Upgrade Jarvis morning-brief to present decision/delegation surfaces
5. Upgrade Jarvis evening-review to measure progression explicitly
6. Reassess whether new cron jobs are still necessary

## 11. Success Criteria

The system should be considered upgraded to a task progression system when:

- Athena signals consistently express recommended action level
- Friday can convert relevant signals into explicit task-handling states
- Jarvis morning output clearly separates decisions, delegations, and watch items
- Jarvis evening output clearly identifies progression vs. non-progression
- the founder can answer "what moved today?" without reading raw notes or raw task state

## 12. Summary

The right next move is not to add more cron immediately.

The right next move is to make the current 7 cron act like a progression loop:

- Athena senses
- Friday commits or defers
- Jarvis frames decisions and checks progression
- Watson condenses reusable knowledge

Only after that loop is consistently working should Phase 2 cron additions be considered.
