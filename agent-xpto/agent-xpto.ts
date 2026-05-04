/**
 * Pi Agent Selector Extension
 *
 * A multi-agent system for pi that allows users to create and switch between
 * different specialized agents, each with their own instructions, tool
 * permissions, and model preferences.
 *
 * Features:
 * - Direct prompt routing to selected agent
 * - Hotkey agent selection (Ctrl+Shift+A cycles through agents)
 * - Per-agent tool limitations
 * - Per-agent model preferences
 * - Per-agent thinking level settings
 *
 * Usage:
 * - /agent - Show/select agents
 * - Ctrl+Shift+A - Cycle to next agent
 * - Ctrl+Shift+S - Open agent selector
 * - Ctrl+Shift+D - Show current agent
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
  BeforeAgentStartEvent,
  BeforeProviderRequestEvent,
} from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadMarkdownAgents, getAgentByIdOrName, runSync, formatSpawnResult, type SpawnResult } from "./spawn";
import type { AgentConfig } from "./types/agent";

// Re-export shared types
export type { ThinkingLevel, ModelConfig, AgentTools, AgentConfig } from "./types/agent";

// ============================================================================
// Types
// ============================================================================

export interface AgentSettings {
  hotkey: string;
  showInStatusBar: boolean;
  rememberLastAgent: boolean;
  cycleWraps: boolean;
}

export interface AgentsConfig {
  version: number;
  agents: AgentConfig[];
  settings: AgentSettings;
  defaultAgent: string;
}

// ============================================================================
// Constants
// ============================================================================

// Agent config file path in user's home directory
const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");
const AGENTS_SUBDIR = "agents";

const DEFAULT_SYSTEM_PROMPT_HEADER = `# Agent Configuration: {agentName}

{agentPurpose}

## Your Capabilities
{capabilities}

## Restrictions
{restrictions}

---

`;

// ============================================================================
// Helper Functions
// ============================================================================

function getAgentsDir(): string {
  return path.join(AGENT_DIR, AGENTS_SUBDIR);
}

function ensureDirectoryExists(): void {
  const dir = getAgentsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function buildCapabilityList(agent: AgentConfig): string {
  const enabledTools = Object.entries(agent.tools)
    .filter(([, enabled]) => enabled === true)
    .map(([tool]) => tool);

  if (enabledTools.length === 0) {
    return "No tools enabled.";
  }

  return `Enabled tools: ${enabledTools.join(", ")}.`;
}

function buildRestrictionList(agent: AgentConfig): string {
  const disabledTools = Object.entries(agent.tools)
    .filter(([, enabled]) => enabled === false)
    .map(([tool]) => tool);

  if (disabledTools.length === 0) {
    return "No restrictions.";
  }

  return `Disabled tools: ${disabledTools.join(", ")}. You CANNOT use these tools.`;
}

function buildAgentSystemPrompt(agent: AgentConfig): string {
  const header = DEFAULT_SYSTEM_PROMPT_HEADER
    .replace("{agentName}", agent.name)
    .replace("{agentPurpose}", agent.systemPrompt || agent.purpose || "Specialized agent")
    .replace("{capabilities}", buildCapabilityList(agent))
    .replace("{restrictions}", buildRestrictionList(agent));

  return header.trim();
}

function getEnabledToolNames(agent: AgentConfig): string[] {
  return Object.entries(agent.tools)
    .filter(([, enabled]) => enabled === true)
    .map(([tool]) => tool);
}

// ============================================================================
// Extension Implementation
// ============================================================================

export default function agentSelectorExtension(pi: ExtensionAPI) {
  // Extension-local state
  let agents: AgentConfig[] = [];
  let currentAgentIndex = 0;
  let settings: AgentSettings = {
    hotkey: "ctrl+shift+a",
    showInStatusBar: true,
    rememberLastAgent: true,
    cycleWraps: true,
  };

  // ============================================================================
  // Agent Management Functions
  // ============================================================================

  function getCurrentAgent(): AgentConfig {
    return agents[currentAgentIndex] || agents[0];
  }

  function switchToAgent(agentId: string): AgentConfig | null {
    const index = agents.findIndex((a) => a.id === agentId);
    if (index >= 0) {
      currentAgentIndex = index;
      return getCurrentAgent();
    }
    return null;
  }

  function cycleAgent(): AgentConfig {
    currentAgentIndex = (currentAgentIndex + 1) % agents.length;
    return getCurrentAgent();
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  function initializeAgents(): void {
    // Load agents from markdown files in ~/.pi/agent/agents/
    agents = loadMarkdownAgents();

    console.log(`[initializeAgents] Loaded ${agents.length} agents:`, agents.map(a => a.name));

    if (agents.length === 0) {
      // No markdown agents found - create the directory
      ensureDirectoryExists();
      console.warn("[agent-xpto] No agent files found in", getAgentsDir());
    }

    // Set initial agent to first one
    currentAgentIndex = agents.length > 0 ? 0 : -1;
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  // Initialize on session start
  pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    initializeAgents();

    const agent = getCurrentAgent();

    if (agent.model) {
      const model = ctx.modelRegistry.find(agent.model.provider, agent.model.model);
      if (model && ctx.modelRegistry.hasConfiguredAuth(model)) {
        await pi.setModel(model);
      } else if (model) {
        ctx.ui.notify(`Agent "${agent.name}" model has no API key`, "warning");
      } else {
        ctx.ui.notify(`Agent "${agent.name}" model not found: ${agent.model.provider}/${agent.model.model}`, "warning");
      }
    }

    if (agent.thinkingLevel) {
      pi.setThinkingLevel(agent.thinkingLevel);
    }

    if (settings.showInStatusBar) {
      ctx.ui.setStatus("agent-xpto", `Agent: ${agent.name}`);
    }
  });

  // Handle agent switching before agent starts
  pi.on(
    "before_agent_start",
    async (event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
      const agent = getCurrentAgent();

      const modifications: {
        systemPrompt?: string;
        message?: { customType: string; content: string; display: boolean };
      } = {};

      // Inject agent-specific system prompt
      if (agent.systemPrompt) {
        const agentPrompt = buildAgentSystemPrompt(agent);
        modifications.systemPrompt = `${agentPrompt}\n\n${event.systemPrompt}`;
      }

      return modifications;
    },
  );

  // Tool call filtering
  pi.on("tool_call", async (event: ToolCallEvent, _ctx: ExtensionContext) => {
    const agent = getCurrentAgent();
    const toolName = event.toolName;

    // Check if tool is explicitly disabled
    if (agent.tools[toolName] === false) {
      return {
        block: true,
        reason: `${agent.name} agent cannot use \`${toolName}\` tool. This tool is disabled for this agent.`,
      };
    }

    return undefined;
  });

  // Cleanup on shutdown
  pi.on("session_shutdown", async (_event: unknown, ctx: ExtensionContext) => {
    if (settings.showInStatusBar) {
      ctx.ui.setStatus("agent-xpto", undefined);
    }
  });

  // ============================================================================
  // Custom Tools
  // ============================================================================

  // Call tool - allows the LLM to delegate tasks to other agents
  pi.registerTool({
    name: "call",
    label: "Call Agent",
    description: "Delegate a task to another agent. Use this when you need specialized help or want to offload work.",
    promptSnippet: "Delegate tasks to specialized agents",
    promptGuidelines: [
      "Use call when the user asks for help that would benefit from a specialized agent.",
      "Use call when a task can be parallelized and done in parallel.",
      "Use call when you want to delegate work while you continue with other tasks.",
      "Use call when the user explicitly asks you to use a specific agent.",
    ],
    parameters: Type.Object({
      agentId: Type.String({
        description: "The ID of the agent to call (e.g., 'reviewer', 'architect', 'debugger')",
      }),
      task: Type.String({
        description: "The task to give the agent. Be specific about what you want the agent to do.",
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const agentId = params.agentId;
      const task = params.task;

      // Check if agent exists
      const targetAgent = getAgentByIdOrName(agentId);
      if (!targetAgent) {
        throw new Error(`Unknown agent: ${agentId}. Use /agents to see available agents.`);
      }

      // Run the agent
      const runId = `call-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const result: SpawnResult = await runSync(targetAgent.id, task, { runId, signal });

      // Format result
      const formattedResult = formatSpawnResult(result);

      return {
        content: [{ type: "text", text: formattedResult }],
        details: {
          agent: targetAgent.name,
          task,
          exitCode: result.exitCode,
          error: result.error,
        },
      };
    },
  });

  // ============================================================================
  // Commands
  // ============================================================================

  // Main agent command - show/select agents
  pi.registerCommand("agent", {
    description: "Show or switch between agents. Usage: /agent [agent-id]",
    handler: async (args: string, ctx: ExtensionContext) => {
      if (!agents.length) {
        ctx.ui.notify("No agents configured", "warning");
        return;
      }

      const trimmedArgs = args.trim();

      // If argument provided, try to match and switch directly
      if (trimmedArgs) {
        const targetAgent = getAgentByIdOrName(trimmedArgs);
        if (targetAgent) {
          const newAgent = switchToAgent(targetAgent.id);
          if (newAgent) {
            if (settings.showInStatusBar) {
              ctx.ui.setStatus("agent-xpto", `Agent: ${newAgent.name}`);
            }
            ctx.ui.notify(`Switched to ${newAgent.name}`, "info");

            // Apply model and thinking level
            if (newAgent.model) {
              const model = ctx.modelRegistry.find(newAgent.model.provider, newAgent.model.model);
              if (model) {
                await pi.setModel(model);
              }
            }
            if (newAgent.thinkingLevel) {
              pi.setThinkingLevel(newAgent.thinkingLevel);
            }
          }
          return;
        } else {
          // No match - show list with warning
          const currentAgent = getCurrentAgent();
          const items: string[] = [];

          for (let i = 0; i < agents.length; i++) {
            const agent = agents[i];
            const marker = agent.id === currentAgent.id ? "▸ " : "  ";
            const model = agent.model ? ` (${agent.model.model})` : "";
            const lines = [`${marker}[${i + 1}] ${agent.name}${model}`];
            if (agent.purpose) {
              lines.push(`      ${agent.purpose}`);
            }
            items.push(lines.join("\n"));
          }

          items.push("---");
          items.push("[C] Cycle to next agent");

          ctx.ui.notify(`Unknown agent: "${trimmedArgs}"`, "warning");
          const selected = await ctx.ui.select("Select Agent", items);

          if (!selected) return;

          // Handle selection (same as below)
          if (selected === "[C] Cycle to next agent") {
            const nextAgent = cycleAgent();
            if (settings.showInStatusBar) {
              ctx.ui.setStatus("agent-xpto", `Agent: ${nextAgent.name}`);
            }
            ctx.ui.notify(`Switched to ${nextAgent.name}`, "info");

            if (nextAgent.model) {
              const model = ctx.modelRegistry.find(nextAgent.model.provider, nextAgent.model.model);
              if (model) {
                await pi.setModel(model);
              }
            }
            if (nextAgent.thinkingLevel) {
              pi.setThinkingLevel(nextAgent.thinkingLevel);
            }
            return;
          }

          const firstLine = selected.split("\n")[0];
          const match = firstLine.match(/\[(\d+)\]\s+(.+)/);
          if (match) {
            const index = parseInt(match[1], 10) - 1;
            if (index >= 0 && index < agents.length) {
              const newAgent = switchToAgent(agents[index].id);
              if (newAgent) {
                if (settings.showInStatusBar) {
                  ctx.ui.setStatus("agent-xpto", `Agent: ${newAgent.name}`);
                }
                ctx.ui.notify(`Switched to ${newAgent.name}`, "info");

                if (newAgent.model) {
                  const model = ctx.modelRegistry.find(newAgent.model.provider, newAgent.model.model);
                  if (model) {
                    await pi.setModel(model);
                  }
                }
                if (newAgent.thinkingLevel) {
                  pi.setThinkingLevel(newAgent.thinkingLevel);
                }
              }
            }
          }
          return;
        }
      }

      // No argument - show interactive picker
      const currentAgent = getCurrentAgent();
      const items: string[] = [];

      for (let i = 0; i < agents.length; i++) {
        const agent = agents[i];
        const marker = agent.id === currentAgent.id ? "▸ " : "  ";
        const model = agent.model ? ` (${agent.model.model})` : "";
        const lines = [`${marker}[${i + 1}] ${agent.name}${model}`];
        if (agent.purpose) {
          lines.push(`      ${agent.purpose}`);
        }
        items.push(lines.join("\n"));
      }

      items.push("---");
      items.push("[C] Cycle to next agent");

      const selected = await ctx.ui.select("Select Agent", items);

      if (!selected) return;

      // Handle cycle option
      if (selected === "[C] Cycle to next agent") {
        const nextAgent = cycleAgent();
        if (settings.showInStatusBar) {
          ctx.ui.setStatus("agent-xpto", `Agent: ${nextAgent.name}`);
        }
        ctx.ui.notify(`Switched to ${nextAgent.name}`, "info");

        // Trigger model/thinking level change
        if (nextAgent.model) {
          const model = ctx.modelRegistry.find(nextAgent.model.provider, nextAgent.model.model);
          if (model) {
            await pi.setModel(model);
          }
        }
        if (nextAgent.thinkingLevel) {
          pi.setThinkingLevel(nextAgent.thinkingLevel);
        }
        return;
      }

      // Parse selection - extract index from first line of multi-line selection
      const firstLine = selected.split("\n")[0];
      const match = firstLine.match(/\[(\d+)\]\s+(.+)/);
      if (match) {
        const index = parseInt(match[1], 10) - 1;
        if (index >= 0 && index < agents.length) {
          const newAgent = switchToAgent(agents[index].id);
          if (newAgent) {
            if (settings.showInStatusBar) {
              ctx.ui.setStatus("agent-xpto", `Agent: ${newAgent.name}`);
            }
            ctx.ui.notify(`Switched to ${newAgent.name}`, "info");

            // Apply model and thinking level
            if (newAgent.model) {
              const model = ctx.modelRegistry.find(newAgent.model.provider, newAgent.model.model);
              if (model) {
                await pi.setModel(model);
              }
            }
            if (newAgent.thinkingLevel) {
              pi.setThinkingLevel(newAgent.thinkingLevel);
            }
          }
        }
      }
    },
  });

  // List all agents with details
  pi.registerCommand("agents", {
    description: "List all configured agents",
    handler: async (_args: string, ctx: ExtensionContext) => {
      if (!agents.length) {
        ctx.ui.notify("No agents configured", "info");
        return;
      }

      const currentAgent = getCurrentAgent();
      const lines: string[] = [`Current: ${currentAgent.name}`, ""];

      for (const agent of agents) {
        const marker = agent.id === currentAgent.id ? "▸ " : "  ";
        const model = agent.model ? ` [${agent.model.provider}/${agent.model.model}]` : "";
        const thinking = agent.thinkingLevel ? ` thinking: ${agent.thinkingLevel}` : "";
        lines.push(`${marker}${agent.name}${model}${thinking}`);

        if (agent.purpose) {
          lines.push(`   ${agent.purpose}`);
        }

        const enabledTools = getEnabledToolNames(agent);
        lines.push(`   Tools: ${enabledTools.join(", ") || "none"}`);
        lines.push("");
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // Call another agent
  pi.registerCommand("call", {
    description: "Call another agent with a task",
    handler: async (args: string, ctx: ExtensionContext) => {
      // Parse arguments: /call <agent-id> <task>
      const trimmedArgs = args.trim();

      // If no arguments provided, show interactive picker
      if (!trimmedArgs) {
        // Check if there are any agents configured
        if (agents.length === 0) {
          ctx.ui.notify("No agents configured. Use /agents to see available agents.", "warning");
          return;
        }

        // Build picker items as strings (ctx.ui.select expects string arrays)
        // Format: "[agent-id] name (model) - purpose"
        const items: string[] = agents.map((agent) => {
          const model = agent.model ? ` (${agent.model.model})` : "";
          const desc = agent.purpose ? ` - ${agent.purpose}` : "";
          return `[${agent.id}] ${agent.name}${model}${desc}`;
        });

        // Show interactive picker
        const selected = await ctx.ui.select("Select Agent to Call", items);

        // User cancelled (pressed Escape)
        if (!selected) {
          return;
        }

        // Parse selection - extract agent ID from "[agent-id] name..." format
        const idMatch = selected.match(/^\[([^\]]+)\]/);
        if (!idMatch) {
          ctx.ui.notify("Invalid selection format", "warning");
          return;
        }
        const agentId = idMatch[1];

        // Find the selected agent by ID
        const targetAgent = agents.find((a) => a.id === agentId);
        if (!targetAgent) {
          ctx.ui.notify(`Selected agent not found: ${agentId}`, "warning");
          return;
        }

        // Prompt for task
        const task = await ctx.ui.input(`Task for ${targetAgent.name}:`, {
          placeholder: "What should this agent do?",
        });

        // User cancelled or provided empty task
        if (!task || !task.trim()) {
          ctx.ui.notify("Task cannot be empty", "warning");
          return;
        }

        // Run the agent
        const runId = `call-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        const result: SpawnResult = await runSync(targetAgent.id, task.trim(), { runId });
        const formattedResult = formatSpawnResult(result);
        ctx.ui.notify(formattedResult, "info");
        return;
      }

      // Split on first space to get agent ID
      const spaceIndex = trimmedArgs.indexOf(" ");
      let agentId: string;
      let task: string;


      if (spaceIndex > 0) {
        agentId = trimmedArgs.substring(0, spaceIndex);
        task = trimmedArgs.substring(spaceIndex + 1).trim();
      } else {
        agentId = trimmedArgs;
        task = "";
      }

      if (!agentId) {
        ctx.ui.notify("Usage: /call <agent-id> <task>", "warning");
        return;
      }

      if (!task) {
        ctx.ui.notify("Task cannot be empty", "warning");
        return;
      }

      // Check if agent exists
      const targetAgent = getAgentByIdOrName(agentId);
      if (!targetAgent) {
        ctx.ui.notify(`Unknown agent: ${agentId}`, "warning");
        return;
      }

      // Run the agent using the found agent's ID
      const runId = `call-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const result: SpawnResult = await runSync(targetAgent.id, task, { runId });

      // Format and return the result
      const formattedResult = formatSpawnResult(result);

      // Return result to parent agent
      ctx.ui.notify(formattedResult, "info");
    },
  });

  // ============================================================================
  // Keyboard Shortcuts
  // ============================================================================

  // Cycle through agents
  pi.registerShortcut("ctrl+shift+a", {
    description: "Cycle to next agent",
    handler: async (ctx: ExtensionContext) => {
      const nextAgent = cycleAgent();

      if (settings.showInStatusBar) {
        ctx.ui.setStatus("agent-xpto", `Agent: ${nextAgent.name}`);
      }
      ctx.ui.notify(`Agent: ${nextAgent.name}`, "info");

      // Apply model and thinking level
      if (nextAgent.model) {
        const model = ctx.modelRegistry.find(nextAgent.model.provider, nextAgent.model.model);
        if (model) {
          await pi.setModel(model);
        }
      }
      if (nextAgent.thinkingLevel) {
        pi.setThinkingLevel(nextAgent.thinkingLevel);
      }
    },
  });

  // Open agent selector
  pi.registerShortcut("ctrl+shift+s", {
    description: "Open agent selector",
    handler: async (ctx: ExtensionContext) => {
      if (!agents.length) {
        ctx.ui.notify("No agents configured", "warning");
        return;
      }

      const currentAgent = getCurrentAgent();
      const items = agents.map((agent) => {
        const marker = agent.id === currentAgent.id ? "▸ " : "  ";
        return `${marker}${agent.name}`;
      });

      const selected = await ctx.ui.select("Select Agent", items);

      if (selected) {
        const name = selected.replace(/^[▸ ]+/, "").trim();
        const agent = agents.find((a) => a.name === name);
        if (agent) {
          switchToAgent(agent.id);
          if (settings.showInStatusBar) {
            ctx.ui.setStatus("agent-xpto", `Agent: ${agent.name}`);
          }
          ctx.ui.notify(`Switched to ${agent.name}`, "info");

          // Apply model and thinking level
          if (agent.model) {
            const model = ctx.modelRegistry.find(agent.model.provider, agent.model.model);
            if (model) {
              await pi.setModel(model);
            }
          }
          if (agent.thinkingLevel) {
            pi.setThinkingLevel(agent.thinkingLevel);
          }
        }
      }
    },
  });

  // Show current agent
  pi.registerShortcut("ctrl+shift+d", {
    description: "Show current agent",
    handler: async (ctx: ExtensionContext) => {
      const agent = getCurrentAgent();
      const model = agent.model ? ` [${agent.model.model}]` : "";
      const thinking = agent.thinkingLevel ? ` | Thinking: ${agent.thinkingLevel}` : "";
      ctx.ui.notify(`Current: ${agent.name}${model}${thinking}`, "info");
    },
  });
}