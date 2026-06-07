# Agent Teams — Master Reference Guide

> Source: https://code.claude.com/docs/en/agent-teams  
> Requires: Claude Code v2.1.32+, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`

---

## Table of Contents

1. [What Are Agent Teams](#1-what-are-agent-teams)
2. [When to Use Agent Teams vs Subagents](#2-when-to-use-agent-teams-vs-subagents)
3. [Enabling Agent Teams](#3-enabling-agent-teams)
4. [Architecture](#4-architecture)
5. [Starting a Team](#5-starting-a-team)
6. [Controlling the Team](#6-controlling-the-team)
7. [Task Management](#7-task-management)
8. [Communication Between Agents](#8-communication-between-agents)
9. [Permissions Model](#9-permissions-model)
10. [Quality Gates via Hooks](#10-quality-gates-via-hooks)
11. [Subagent Definitions for Teammates](#11-subagent-definitions-for-teammates)
12. [Token Costs](#12-token-costs)
13. [Best Practices](#13-best-practices)
14. [Proven Use Case Patterns](#14-proven-use-case-patterns)
15. [Troubleshooting](#15-troubleshooting)
16. [Known Limitations](#16-known-limitations)
17. [Quick-Reference Cheat Sheet](#17-quick-reference-cheat-sheet)

---

## 1. What Are Agent Teams

An agent team is a set of coordinated Claude Code instances where:

- **One session is the Team Lead** — creates the team, spawns teammates, assigns/coordinates work, synthesizes results, and cleans up.
- **Teammates are independent sessions** — each has its own context window, loads project context fresh (CLAUDE.md, MCP servers, skills), and communicates directly with other teammates via a shared mailbox.
- **A shared task list** coordinates work. Teammates claim tasks, mark them complete, and unblock dependent tasks automatically.

Unlike subagents (which only report back to the caller), teammates can message each other directly and work entirely in parallel without routing through the lead.

---

## 2. When to Use Agent Teams vs Subagents

### Use Agent Teams When

- Work can be genuinely parallelized with minimal file overlap
- Teammates need to share findings, debate hypotheses, or challenge each other
- The task spans multiple independent domains (frontend / backend / tests; security / performance / coverage)
- You want to investigate competing root causes simultaneously

### Use Subagents Instead When

- Tasks are sequential or tightly coupled
- Workers only need to return a result — no inter-agent discussion required
- You want lower token cost (subagent results summarize back to the main context)
- Multiple agents would edit the same files

### Comparison Table

| Dimension | Subagents | Agent Teams |
|---|---|---|
| Context | Own window; results return to caller | Own window; fully independent |
| Communication | Report back to main agent only | Message each other directly |
| Coordination | Main agent manages all work | Shared task list with self-coordination |
| Best for | Focused tasks where only result matters | Complex work requiring discussion |
| Token cost | Lower | Higher (each teammate is a full Claude instance) |

---

## 3. Enabling Agent Teams

Add to `.claude/settings.local.json` (project-local, not committed):

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Or export in shell:

```bash
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

---

## 4. Architecture

### Components

| Component | Role |
|---|---|
| Team Lead | Main session — creates team, spawns teammates, coordinates, cleans up |
| Teammates | Separate Claude instances working on assigned tasks |
| Task List | Shared work items with pending / in-progress / completed states and dependency tracking |
| Mailbox | Messaging system for direct agent-to-agent communication |

### Storage Locations (local only)

- **Team config**: `~/.claude/teams/{team-name}/config.json` — runtime state (session IDs, tmux pane IDs). **Never edit by hand; overwritten on every state update.**
- **Task list**: `~/.claude/tasks/{team-name}/`

The `config.json` holds a `members` array (name, agent ID, agent type). Teammates can read this to discover peers.

> **There is no project-level team config.** A `.claude/teams/teams.json` in the project directory is treated as an ordinary file and ignored by Claude.

### Display Modes

| Mode | Description | Requirement |
|---|---|---|
| `in-process` (default fallback) | All teammates run in main terminal; Shift+Down cycles through them | Any terminal |
| `tmux` / split panes | Each teammate in its own pane; full parallel visibility | tmux or iTerm2 + `it2` CLI |
| `auto` (default) | Split panes if already inside tmux; in-process otherwise | — |

Override globally in `~/.claude/settings.json`:

```json
{ "teammateMode": "in-process" }
```

Override for a single session:

```bash
claude --teammate-mode in-process
```

**Split panes NOT supported in:** VS Code integrated terminal, Windows Terminal, Ghostty.

---

## 5. Starting a Team

Tell Claude in natural language. Describe the task and team structure. Claude creates the team, spawns teammates, and coordinates from there.

**Effective spawn prompt structure:**
1. Describe the overall goal
2. Name each teammate role explicitly (gives predictable names you can reference later)
3. Specify models if needed
4. Include task-specific context the teammates won't have from conversation history

**Example:**

```
Create an agent team to explore the new payments module design from three angles.
Spawn three teammates named "ux-reviewer", "arch-reviewer", and "devils-advocate".
Use Sonnet for each. Each teammate should investigate independently and then
share findings with the others before the lead synthesizes a recommendation.
```

Claude may also **propose** a team on its own for complex tasks — you confirm before it proceeds.

---

## 6. Controlling the Team

All high-level direction goes through the lead in natural language.

### Interacting with Teammates Directly

- **In-process**: Shift+Down cycles through teammates → type to message → Enter to view session → Escape to interrupt current turn → Ctrl+T toggles task list
- **Split panes**: click into pane → interact directly

### Specifying Models

Teammates do not inherit the lead's `/model` by default. To set a default:

- In `/config` → **Default teammate model** → choose **Default (leader's model)** to follow the lead's model
- Or specify per-spawn: `"Use Sonnet for each teammate"`

### Requiring Plan Approval

Keeps risky teammates in read-only mode until the lead approves their plan:

```
Spawn an architect teammate to refactor the auth module.
Require plan approval before they make any changes.
```

- Teammate submits plan → lead reviews → approves (teammate proceeds) or rejects with feedback (teammate revises and resubmits)
- Lead makes approval decisions autonomously — shape its judgment in the prompt: `"only approve plans that include test coverage"`

### Shutting Down Individual Teammates

```
Ask the researcher teammate to shut down
```

Lead sends a shutdown request; teammate can approve (graceful exit) or reject with explanation.

### Cleaning Up the Team

```
Clean up the team
```

**Always use the lead to clean up.** Cleanup fails if active teammates are still running — shut them down first. Teammates should never run cleanup themselves (their team context may not resolve correctly).

---

## 7. Task Management

### Task States
- **Pending** — not yet claimed
- **In Progress** — claimed by a teammate
- **Completed** — done

### Dependencies
Tasks can depend on other tasks. A pending task with unresolved dependencies cannot be claimed. When a blocking task completes, dependent tasks unblock automatically — no manual intervention.

### Assignment
- **Lead assigns explicitly**: tell the lead which task goes to which teammate
- **Self-claim**: teammate picks up the next unassigned, unblocked task automatically after finishing

### Race Condition Prevention
Task claiming uses **file locking** to prevent two teammates from claiming the same task simultaneously.

### Sizing Tasks
| Size | Problem |
|---|---|
| Too small | Coordination overhead exceeds benefit |
| Too large | Teammates work too long without check-ins; risk of wasted effort |
| Just right | Self-contained unit producing a clear deliverable (a function, a test file, a review) |

Target **5–6 tasks per teammate** to keep everyone productive without excessive context switching.

If the lead isn't creating enough tasks: `"Split the work into smaller pieces"`

If the lead starts doing work instead of delegating: `"Wait for your teammates to complete their tasks before proceeding"`

---

## 8. Communication Between Agents

- **Automatic delivery**: messages sent by teammates arrive at recipients without the lead polling
- **Idle notification**: when a teammate finishes and stops, it automatically notifies the lead
- **Shared task list**: all agents see task status and can claim available work
- **Direct messaging**: any teammate can message any other by name; to reach everyone, send one message per recipient (no broadcast)

Teammates are assigned names by the lead at spawn time. For predictable names you can reference in prompts, specify them in the spawn instruction.

---

## 9. Permissions Model

- Teammates **start with the lead's permission settings**
- If the lead runs with `--dangerously-skip-permissions`, all teammates do too
- You **can** change individual teammate permission modes after spawning
- You **cannot** set per-teammate modes at spawn time

**Reduce permission prompts**: pre-approve common operations in permission settings before spawning teammates. Teammate permission requests bubble up to the lead, which can create friction at scale.

---

## 10. Quality Gates via Hooks

Use hooks to enforce rules automatically:

| Hook | Trigger | Use |
|---|---|---|
| `TeammateIdle` | Teammate about to go idle | Exit code 2 to send feedback and keep teammate working |
| `TaskCreated` | Task being created | Exit code 2 to prevent creation and send feedback |
| `TaskCompleted` | Task being marked complete | Exit code 2 to prevent completion and send feedback |

Configure in `.claude/settings.json` under the `hooks` key.

---

## 11. Subagent Definitions for Teammates

You can reference a named [subagent type](https://code.claude.com/docs/en/sub-agents) (from project, user, plugin, or CLI scope) when spawning a teammate. This lets you define roles once and reuse them.

```
Spawn a teammate using the security-reviewer agent type to audit the auth module.
```

Behavior when used as a teammate:
- The definition's `tools` allowlist and `model` are honored
- The definition body is **appended** to the teammate's system prompt (not a replacement)
- Team coordination tools (`SendMessage`, task management) are **always available** regardless of `tools` restrictions
- `skills` and `mcpServers` frontmatter fields are **NOT applied** — teammates load these from project/user settings like a regular session

---

## 12. Token Costs

Token usage **scales linearly** with active teammates — each has its own full context window. Agent teams cost significantly more than a single session or subagents.

**Worth it for**: research, review, new feature work with parallel independent domains  
**Not worth it for**: routine tasks, sequential work, tasks with many file-level dependencies

See [agent team token costs](https://code.claude.com/docs/en/costs#agent-team-token-costs) for usage guidance.

---

## 13. Best Practices

### Team Size
- **Start with 3–5 teammates** — balances parallelism with manageable coordination
- Scale up only when work genuinely benefits from simultaneous effort
- Three focused teammates often outperform five scattered ones
- More teammates = more coordination overhead and diminishing returns

### Give Teammates Enough Context at Spawn Time
Teammates do NOT inherit the lead's conversation history. Include everything they need in the spawn prompt:

```
Spawn a security reviewer teammate with the prompt: "Review the authentication
module at src/auth/ for security vulnerabilities. Focus on token handling,
session management, and input validation. The app uses JWT tokens stored in
httpOnly cookies. Report issues with severity ratings."
```

### Avoid File Conflicts
Two teammates editing the same file leads to overwrites. Structure work so each teammate owns a distinct set of files.

### Monitor and Steer
- Check in on teammates' progress regularly
- Redirect approaches that aren't working early
- Synthesize findings as they come in
- Don't let teams run unattended for long — wasted effort accumulates

### Use CLAUDE.md
Teammates read `CLAUDE.md` from their working directory normally. Use it to provide project-specific guidance that applies to all teammates without repeating it in every spawn prompt.

### Start with Research/Review Tasks
If new to agent teams, begin with tasks that have clear boundaries and don't require writing code (PR review, library research, bug investigation). These show the value of parallel exploration without the coordination risks of parallel implementation.

---

## 14. Proven Use Case Patterns

### Pattern 1: Parallel Code Review with Distinct Lenses

Split review criteria into independent domains so each gets thorough attention simultaneously:

```
Create an agent team to review PR #142. Spawn three reviewers:
- One focused on security implications
- One checking performance impact
- One validating test coverage
Have them each review and report findings.
```

### Pattern 2: Competing Hypotheses / Scientific Debate

When root cause is unclear, make teammates adversarial. Each investigates a theory AND actively tries to disprove the others:

```
Users report the app exits after one message instead of staying connected.
Spawn 5 agent teammates to investigate different hypotheses. Have them talk
to each other to try to disprove each other's theories, like a scientific
debate. Update the findings doc with whatever consensus emerges.
```

Why this works: sequential investigation suffers from anchoring bias. A theory that survives adversarial parallel attack is much more likely to be the real root cause.

### Pattern 3: Independent Module Development

Teammates each own a separate module with no shared files:

```
Create a team with 4 teammates to implement these four independent modules
in parallel. Assign one module per teammate. Use Sonnet for each.
```

### Pattern 4: Cross-Layer Coordination

Changes spanning frontend, backend, and tests — each owned by a different teammate:

```
Spawn three teammates: one for the React components in src/ui/, one for the
API handlers in src/api/, and one for the integration tests in tests/.
Each should implement their layer and message the others when ready
for integration.
```

### Pattern 5: Multi-Perspective Exploration

Exploring a new design space from multiple angles before committing:

```
Create an agent team to explore this CLI tool design from different angles:
one teammate on UX, one on technical architecture, one playing devil's advocate.
Have them share and challenge each other's findings, then the lead synthesizes
a recommendation.
```

---

## 15. Troubleshooting

| Problem | Fix |
|---|---|
| Teammates not appearing | Press Shift+Down (in-process mode); verify task was complex enough to warrant a team; check `which tmux` if split panes requested |
| Too many permission prompts | Pre-approve common operations in permission settings before spawning |
| Teammates stopping on errors | Shift+Down to check output; give additional instructions directly or spawn a replacement |
| Lead shuts down before work is done | Tell lead to keep going; tell it to wait for teammates before proceeding |
| Orphaned tmux sessions | `tmux ls` then `tmux kill-session -t <session-name>` |
| Task status lagging | Check if work is actually done; update status manually or tell lead to nudge the teammate |
| iTerm2 split panes not working | Verify `it2` CLI installed; enable Python API in iTerm2 → Settings → General → Magic |

---

## 16. Known Limitations

| Limitation | Detail |
|---|---|
| No session resumption with in-process teammates | `/resume` and `/rewind` don't restore in-process teammates; lead may message non-existent teammates — tell it to spawn new ones |
| Task status can lag | Teammates sometimes fail to mark tasks complete, blocking dependent tasks |
| Slow shutdown | Teammates finish their current request/tool call before shutting down |
| One team at a time | Clean up the current team before creating a new one |
| No nested teams | Teammates cannot spawn their own teams; only the lead manages the team |
| Lead is fixed | The session that creates the team is lead for its lifetime; no leadership transfer |
| Permissions set at spawn | All teammates start with lead's permission mode; can't set per-teammate modes at spawn time |
| Split panes terminal support | Only tmux and iTerm2; not VS Code integrated terminal, Windows Terminal, or Ghostty |

---

## 17. Quick-Reference Cheat Sheet

```
# Enable
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1  (or settings.json env block)

# Minimum version
claude --version  →  must be >= 2.1.32

# Create a team
"Create an agent team with teammates named X, Y, Z. [task description]"

# Display mode
--teammate-mode in-process | tmux
{ "teammateMode": "in-process" }  in ~/.claude/settings.json

# Navigate teammates (in-process)
Shift+Down     cycle through teammates
Enter          view teammate session
Escape         interrupt current turn
Ctrl+T         toggle task list

# Delegate
"Wait for teammates to finish before proceeding"
"Split the work into smaller pieces"

# Plan approval gate
"Require plan approval before [teammate] makes any changes"

# Shut down / clean up
"Ask [teammate] to shut down"
"Clean up the team"           ← always from the lead

# Hooks for quality gates
TeammateIdle   → exit 2 to keep teammate working
TaskCreated    → exit 2 to block task creation
TaskCompleted  → exit 2 to block task completion

# Orphaned tmux cleanup
tmux ls
tmux kill-session -t <name>

# Optimal team size: 3–5 teammates, 5–6 tasks per teammate
```

---

*This guide reflects the Claude Code experimental agent teams feature as documented. Update when the feature exits experimental status.*
