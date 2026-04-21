# AGENTS.md — Task Manager Extension

This extension manages project tasks via Markdown files with PowerShell CRUD scripts.

## Overview

- **Purpose**: Task tracking with Backlog → Active → Closed workflow
- **Task Storage**: `~/.pi/tasks/<workspace>/<folder>/<task>.md`
- **Workspace Detection**: Derived from current working directory (e.g., `C:/repo/test` → `C--repo-test`)

## Folder Structure

Tasks are organized by workspace (derived from cwd):

```
~/.pi/tasks/
├── C-repo/           # Workspace: C:/repo
│   ├── Backlog/      # Pending tasks
│   ├── Active/       # Currently working on (single task)
│   ├── user-qa/      # Completed tasks pending user QA
│   └── Closed/       # Tasks finished with user QA
└── Another-Workspace/
```

## Task Format

```markdown
---
id: <uuid>
title: Task Title
created: YYYY-MM-DD
priority: low|medium|high|critical
tags:
  - tag1
---

# Task Title

## Notes
<!-- Agent appends progress here -->
```

## Available Tools

Use the `tasks` tool for all task management:

| Action | Parameters | Description |
|--------|------------|-------------|
| `list` | — | Show all tasks across folders |
| `create` | `title`, `priority` | Create new task in Backlog (workspace auto-detected) |
| `move` | `name`, `folder` | Move task to Backlog/Active/Closed |
| `append` | `name`, `content` | Add content to task |
| `delete` | `name` | Delete a task |
| `rename` | `name`, `newTitle` | Rename a task |
| `search` | `name` | Find task by name |
| `get` | `name` | Get full task content |

### Tool Usage Examples

```typescript
// List all tasks
tasks(action="list")

// Create a new task
tasks(action="create", title="Implement authentication", priority="high")

// Move task to Active
tasks(action="move", name="design-auth", folder="Active")

// Add progress notes
tasks(action="append", name="design-auth", content="## Progress\n- Completed API design")

// Search for a task
tasks(action="search", name="auth")
```

**Note**: The workspace is always derived from the agent's current working directory. Agents cannot manually set the workspace.

## Available Commands

| Command | Description |
|---------|-------------|
| `/tasks` | List all tasks with interactive picker |
| `/task <name>` | Assign task to Active (auto-switches) |
| `/task-new <title> [--priority=high]` | Create new task in Backlog |
| `/task-complete <name>` | Mark task as complete (moves to user-qa) |

### Command Examples

```bash
# Create a high-priority task
/task-new Implement authentication --priority=high

# Assign existing task to active
/task design-auth

# Mark task as complete (moves to user-qa)
/task-complete design-auth

# View all tasks
/tasks
```

## Agent Guidelines

### Do: Use Task Tools

- Use `tasks(action="list")` to see all tasks
- Use `tasks(action="create", ...)` to create new tasks (workspace auto-detected from cwd)
- Use `tasks(action="append", ...)` to record progress
- Check Active task at session start

### Don't: Access Tasks Folder Directly

The extension **blocks direct access** to `~/.pi/tasks/` via write/edit/bash tools. All task operations must go through:

1. The `tasks` tool
2. The `/task`, `/tasks`, `/task-new`, `/task-complete` commands
3. Direct PowerShell scripts (for advanced use)

### Active Task Policy

- Only **one** task can be Active at a time
- Moving a new task to Active auto-moves the current one to Backlog
- Use `/task <name>` to switch active tasks

## Direct PowerShell Scripts

For automation, scripts are in `scripts/` folder:

```powershell
# List tasks in a folder
./scripts/list-tasks.ps1 -Workspace "C-repo" -Folder "Backlog"

# Create a task
./scripts/create-task.ps1 -Workspace "C-repo" -Title "My Task" -Priority "high"

# Move a task
./scripts/move-task.ps1 -Workspace "C-repo" -Name "my-task" -NewFolder "Active"

# Append content
./scripts/append-task.ps1 -Workspace "C-repo" -Name "my-task" -Content "## Progress"

# Delete a task
./scripts/delete-task.ps1 -Workspace "C-repo" -Name "my-task"

# Rename a task
./scripts/rename-task.ps1 -Workspace "C-repo" -Name "my-task" -NewTitle "New Title"
```

## Priority Levels

| Level | Use Case |
|-------|----------|
| `low` | Nice-to-have improvements |
| `medium` | Default, standard work |
| `high` | Important, should do soon |
| `critical` | Must address immediately |

## Session Behavior

On session start:
- If no Active task → notify about Backlog count
- If Active task exists → display it
- If multiple Active tasks → prompt to manage them