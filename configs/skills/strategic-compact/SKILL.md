---
name: strategic-compact
description: How to summarise and compact a long conversation without losing the decisions, constraints, and open threads that matter.
---

# Strategic Compaction

Compaction is lossy by nature. The goal is not "keep as much text as possible"
— it is **keep the parts that change future behaviour**.

**What must survive compaction**
- **Goal** — the one sentence the user actually asked for.
- **Decisions made** — what was chosen, and what was explicitly rejected.
- **Constraints** — hard requirements, stack choices, file paths, conventions in force.
- **Artifacts** — files created or modified, with their paths.
- **Open threads** — what is unfinished, what is blocked, what is next.
- **Corrections** — explicit user feedback that changes how work should be done.

**What may be dropped**
- Restated problem statements.
- Full tool outputs already summarised ("read 40 files, found 3 relevant").
- Abandoned approaches and the reasoning that led nowhere.
- Repeated confirmations ("yes, do that").
- Verbose narration of steps that are recorded in the diff anyway.

**How to compact**
1. Read the conversation and identify the goal, the decisions, the constraints,
   and the open threads. Ignore the narrative.
2. Write each as a terse, factual statement. No hedging, no "the user
   mentioned that they might want to...".
3. Keep exact identifiers: file paths, function names, error strings, versions.
   These are the things that get lost and are needed later.
4. Record *why* a decision was made when the reason is not obvious from the
   decision itself. A decision without its rationale gets relitigated.
5. Store errors and their fixes — a resolved error is knowledge, an unresolved
   one is a task.

**Rules**
- Never drop a decision without its reason.
- Never invent a decision that was not made.
- Never leave an open thread unstated — an unstated thread becomes a forgotten
  thread.
- Keep the original request's wording for the goal; paraphrasing drifts.
- A summary longer than the original conversation has failed.
