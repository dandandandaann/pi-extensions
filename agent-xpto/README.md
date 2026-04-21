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

Agent configuration is loaded from `~/.pi/agent/agents.json` (global).

### Option 2: Global installation

The extension is auto-discovered from the global extensions directory:

```
~/.pi/agent/extensions/
```

Copy `agent-xpto.ts` there. The agent configuration will be loaded from:

```
~/.pi/agent/agents.json
```

## Configuration

Edit `~/.pi/agent/agents.json` to configure your agents:

```json
{
  "version": 1,
  "agents": [
    {
      "id": "default",
      "name": "Default",
      "description": "General purpose coding assistant",
      "systemPrompt": "You are a versatile coding assistant.",
      "tools": {
        "read": true,
        "write": true,
        "edit": true,
        "bash": true,
        "grep": true,
        "find": true
      },
      "model": {
        "provider": "anthropic",
        "model": "claude-opus-4-5"
      },
      "thinkingLevel": "medium"
    }
  ],
  "settings": {
    "hotkey": "ctrl+shift+a",
    "showInStatusBar": true,
    "rememberLastAgent": true,
    "cycleWraps": true
  },
  "defaultAgent": "default"
}
```

### Agent Configuration Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for the agent |
| `name` | string | Display name for the agent |
| `description` | string | Brief description of the agent's role |
| `systemPrompt` | string | Custom instructions for this agent |
| `tools` | object | Tool permissions (true/false for each tool) |
| `model` | object | Preferred model (`provider` and `model`) |
| `thinkingLevel` | string | Thinking level: "off", "minimal", "low", "medium", "high", "xhigh" |

### Settings

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

## Example Agents

### Code Reviewer

A read-only reviewer that analyzes code without making changes:

```json
{
  "id": "reviewer",
  "name": "Reviewer",
  "description": "Code review specialist",
  "systemPrompt": "You are a code reviewer. Analyze code and provide feedback. Do NOT make any changes.",
  "tools": {
    "read": true,
    "write": false,
    "edit": false,
    "bash": false,
    "grep": true,
    "find": true
  },
  "model": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-5"
  },
  "thinkingLevel": "high"
}
```

### System Architect

Focuses on design and architecture without modifying code:

```json
{
  "id": "architect",
  "name": "Architect",
  "description": "System design specialist",
  "systemPrompt": "You are a system design expert. Focus on architecture and best practices.",
  "tools": {
    "read": true,
    "write": true,
    "edit": false,
    "bash": false
  },
  "model": {
    "provider": "anthropic",
    "model": "claude-opus-4-5"
  },
  "thinkingLevel": "high"
}
```

### Debugger

Specializes in troubleshooting and fixes:

```json
{
  "id": "debugger",
  "name": "Debugger",
  "description": "Debugging specialist",
  "systemPrompt": "You are a debugging expert. Analyze errors and provide solutions.",
  "tools": {
    "read": true,
    "write": true,
    "edit": true,
    "bash": true,
    "grep": true,
    "find": true
  },
  "model": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-5"
  },
  "thinkingLevel": "medium"
}
```

## Architecture

### Extension Components

1. **Agent Configuration Loader** - Loads agents from `agents.json`
2. **Agent State Manager** - Tracks current agent and handles switching
3. **Status Bar Display** - Shows current agent in footer
4. **Tool Filter** - Intercepts and blocks disabled tools
5. **System Prompt Injector** - Adds agent-specific instructions
6. **Model & Thinking Level Controller** - Applies agent preferences

### Event Flow

1. Session starts → Load agents from config
2. User sends prompt → `before_agent_start` injects system prompt
3. Tool called → `tool_call` filters based on agent tools
4. Agent starts → `agent_start` applies model/thinking level
5. User presses hotkey → Cycle/select agent, update status

## License

MIT
