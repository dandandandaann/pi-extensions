# Pi Agent XPTO

A multi-agent system for pi, similar to OpenCode. The system allows users to create and switch between different specialized agents, each with their own instructions, tool permissions, and model preferences.

## Features

- **Direct Prompt Routing** - Prompts are sent to the selected agent
- **Hotkey Agent Selection** - Configurable hotkeys to cycle through agents
- **Per-Agent Configuration**:
  - Custom system prompt/instructions
  - Tool limitations (enable/disable specific tools)
  - Model preferences
  - Thinking level settings
- **Status Bar Display** - Shows current agent name
- **Tool Filtering** - Blocks tools that are disabled for the current agent

## Installation

### Option 1: Project-local (recommended for per-project agents)

Copy the extension files to your project's `.pi/extensions/` directory:

```
your-project/
├── .pi/
│   └── extensions/
│       └── agent-xpto.ts
```

Agent configuration is loaded from `~/.pi/agent/agents/` (global markdown files).

### Option 2: Global installation

The extension is auto-discovered from the global extensions directory:

```
~/.pi/agent/extensions/
```

Copy `agent-xpto.ts` there. The agent configuration will be loaded from:

```
~/.pi/agent/agents/
```

## Agent Configuration

Agents are defined as markdown files in `~/.pi/agent/agents/`. Each `.md` file represents one agent with YAML frontmatter metadata.

### File Format

```markdown
---
name: ☁️ Default
description: General purpose coding assistant
tools:
  read: true
  grep: true
  find: true
  bash: true
  write: true
  edit: true
model: minimax/MiniMax-M2.7
thinking: medium
---

You are a versatile coding assistant. Help users write, review, and debug code.
```

### Frontmatter Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name for the agent (required) |
| `description` | string | Brief description of the agent's role |
| `tools` | object | Tool permissions (true/false for each tool) |
| `model` | string | Model in `provider/model` format (e.g., `minimax/MiniMax-M2.7`) |
| `thinking` | string | Thinking level: "off", "minimal", "low", "medium", "high", "xhigh" |

### Body Content

The content after the closing `---` becomes the agent's `systemPrompt`.

### Default Tools

Tools not listed in the frontmatter default to `false`.

### Example Agents

Create these files in `~/.pi/agent/agents/`:

#### default.md

```markdown
---
name: ☁️ Default
description: General purpose coding assistant
tools:
  read: true
  grep: true
  find: true
  bash: true
  write: true
  edit: true
model: minimax/MiniMax-M2.7
thinking: medium
---

You are a versatile coding assistant. Help users write, review, and debug code.
```

#### planner.md

```markdown
---
name: 📝 Planner
description: Creates implementation plans from context and requirements
tools:
  read: true
  grep: true
  find: true
  bash: false
  write: false
model: minimax/MiniMax-M2.7
thinking: high
---

You are a planning subagent. Your job is to turn requirements into concrete plans.
```

#### scout.md

```markdown
---
name: 🔍 Scout
description: Fast codebase reconnaissance
tools:
  read: true
  grep: true
  find: true
  ls: true
  bash: false
  write: false
  edit: false
thinking: low
---

You are a fast reconnaissance agent. Quickly explore and summarize codebases.
```

#### worker.md

```markdown
---
name: ⚙️ Worker
description: General implementation agent
tools:
  read: true
  write: true
  edit: true
  bash: true
  grep: true
  find: true
model: minimax/MiniMax-M2.7
thinking: medium
---

You are a general implementation agent. Write, modify, and debug code.
```

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `hotkey` | `ctrl+shift+a` | Hotkey to cycle agents |
| `showInStatusBar` | `true` | Show agent name in status bar |
| `rememberLastAgent` | `true` | Restore last used agent on reload |
| `cycleWraps` | `true` | Cycle wraps from last to first agent |

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `/agent` | Open agent selector |
| `/agents` | List all configured agents |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+A` | Cycle to next agent |
| `Ctrl+Shift+S` | Open agent selector |
| `Ctrl+Shift+D` | Show current agent info |

## Architecture

### Extension Components

1. **Agent Loader** - Loads agents from `.md` files in `~/.pi/agent/agents/`
2. **Agent State Manager** - Tracks current agent and handles switching
3. **Status Bar Display** - Shows current agent in footer
4. **Tool Filter** - Intercepts and blocks disabled tools
5. **System Prompt Injector** - Adds agent-specific instructions
6. **Model & Thinking Level Controller** - Applies agent preferences

### Event Flow

1. Session starts → Load agents from markdown files
2. User sends prompt → `before_agent_start` injects system prompt
3. Tool called → `tool_call` filters based on agent tools
4. Agent starts → `agent_start` applies model/thinking level
5. User presses hotkey → Cycle/select agent, update status

## License

MIT