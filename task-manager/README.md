# Task Manager Extension

Manages project tasks via MD files with PowerShell CRUD scripts.

## Folder Structure

Tasks are separated by workspace/folder. Tasks for `C:/temp` go to:

```
~/.pi/tasks/
├── C-temp/           # Workspace: C:/temp
│   ├── Backlog/      # Pending tasks
│   ├── Active/       # Currently working on (single task)
│   ├── user-qa/
│   └── Closed/       # Completed tasks
├── Another-Workspace/
│   ├── Backlog/
│   ├── Active/
│   ├── user-qa/
│   └── Closed/
└── ...
```

## Task MD Format

```markdown
---
id: <uuid>
title: Task Title
created: YYYY-MM-DD
priority: low|medium|high|critical
tags:
  - tag1
  - tag2
---

# Task Title

## Notes
<!-- Agent appends progress here -->
```

## Commands

| Command | Description |
|---------|-------------|
| `/tasks` | List all tasks by folder |
| `/task <name>` | Assign a task to Active |
| `/task-new <title> [--priority=high]` | Create new task in Backlog |
| `/task-open <name>` | Open a task file in the default editor |
| `/task-complete <name>` | Mark task as complete (moves to user-qa) |

## Tools (for LLM)

| Action | Description |
|--------|-------------|
| `list` | Show all tasks |
| `move` | Move task to folder |
| `append` | Add content to task |
| `delete` | Delete a task |
| `rename` | Rename a task |
| `search` | Find task by name |
| `get` | Get full task content |

## Usage Examples

```bash
# Create a task
/task-new Design authentication flow --priority=high

# List all tasks
/tasks

# Mark task as complete (moves to user-qa)
/task-complete design-auth

# Assign a task
/task design-auth

# Agent tool usage
tasks(action="list")
tasks(action="move", name="design-auth", folder="Active")
tasks(action="append", name="design-auth", content="## Progress\n- Set up OAuth providers")
```

## Direct PS1 Scripts

Scripts are in `scripts/` folder for direct access if needed:

- `list-tasks.ps1 -Folder <Backlog|Active|Closed>`
- `create-task.ps1 -Title <name> -Priority <level>`
- `move-task.ps1 -Name <name> -NewFolder <folder>`
- `append-task.ps1 -Name <name> -Content <text>`
- `delete-task.ps1 -Name <name>`
- `rename-task.ps1 -Name <name> -NewTitle <title>`
