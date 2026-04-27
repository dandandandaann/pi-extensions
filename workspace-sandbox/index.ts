/**
 * Workspace Sandbox Extension
 *
 * Prompts for permission when bash/write/edit commands target paths
 * outside the current working directory.
 *
 * Commands:
 *   /sandbox status          - Show current mode and status
 *   /sandbox allow-all       - Allow all operations until next user input
 *   /sandbox mode-sandbox    - Disable allow-all, return to normal sandbox mode
 *   /sandbox mode-strict     - Auto-deny ALL security checks (no prompts)
 *   /sandbox dangerous-patterns - List dangerous patterns being checked
 *
 * Strict Mode:
 *   When enabled via /sandbox mode-strict, ALL security checks are automatically
 *   denied without any UI prompts. Use /sandbox mode-sandbox to disable.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import path from "node:path";
import os from "node:os";
import {
  isWindowsDrive,
  isSameDrive,
  normalizeGitBashPath,
  resolveHome,
  resolveTargetPath,
  isPathOutsideWorkspace,
  extractPathsFromCommand,
  containsDangerousPattern,
  isReadOnlyCommand,
  getToolTargetPath,
  getExtensionScriptDirs,
} from "./src/internal";

const VERSION = "0.1.4";

interface WorkspaceSandboxConfig {
  allowedDirs?: string[];
  skipDangerousCheck?: boolean;
  dangerousPatterns?: string[];
}

// Track allow-all state (reset on new user input)
let allowAllUntilInput = false;

// Track strict mode (auto-deny all security checks)
let strictMode = false;

export default function (pi: ExtensionAPI) {
  // --- Configuration ---
  const config: WorkspaceSandboxConfig = {
    allowedDirs: [],
    skipDangerousCheck: false,
    dangerousPatterns: [
      "rm -rf",
      "sudo",
      "mkfs",
      ":(){:|:&};:",
      "> /dev/sda",
      // Git remote-modifying commands
      "git push",
    ],
  };

  // Try to load config from settings (read from a custom config file if needed)
  // For simplicity, we'll use hardcoded defaults + environment variable override
  if (process.env.PI_WORKSPACE_ALLOWED_DIRS) {
    config.allowedDirs = process.env.PI_WORKSPACE_ALLOWED_DIRS.split(",").map((d: string) =>
      path.resolve(d.trim().replace(/^~/, os.homedir()))
    );
  }

  // Register /sandbox command for status and manual control
  pi.registerCommand("sandbox", {
    description: "Toggle workspace sandbox - 'allow-all' to enable Allow All, 'mode-sandbox' to disable",
    getArgumentCompletions: (prefix: string) => {
      const opts = ["status", "allow-all", "mode-sandbox", "mode-strict", "dangerous-patterns"];
      return opts.filter(o => o.startsWith(prefix)).map(o => ({ value: o, label: o }));
    },
    handler: async (args: string | undefined, ctx: { ui: { notify: (msg: string, type: string) => void } }) => {
      const cmd = args?.toLowerCase();
      
      if (!cmd || cmd === "status") {
        const strictStatus = strictMode ? "🔴 STRICT" : "🔒";
        const allowStatus = allowAllUntilInput ? "🟢 Allow All" : "";
        const statusParts = [strictStatus, allowStatus].filter(Boolean).join(" + ") || "Normal";
        ctx.ui.notify(`${statusParts} [v${VERSION}] - ${(config.dangerousPatterns || []).length} dangerous patterns`, "info");
        return;
      }
      
      if (cmd === "allow-all") {
        allowAllUntilInput = true;
        strictMode = false;
        ctx.ui.notify("Allow All activated (strict mode disabled)", "info");
        return;
      }
      
      if (cmd === "mode-sandbox") {
        allowAllUntilInput = false;
        strictMode = false;
        ctx.ui.notify("Sandbox is now activated in normal mode", "info");
        return;
      }
      
      if (cmd === "mode-strict") {
        strictMode = true;
        allowAllUntilInput = false;
        ctx.ui.notify("🔴 Strict mode activated - all security checks auto-denied", "info");
        return;
      }
      
      if (cmd === "dangerous-patterns") {
        const patterns = (config.dangerousPatterns || []).join(", ");
        ctx.ui.notify(`Dangerous patterns: ${patterns}`, "info");
        return;
      }
      
      ctx.ui.notify("Usage: /sandbox [status|allow-all|mode-sandbox|mode-strict|dangerous-patterns]", "info");
    },
  });

  // --- Main Handler ---
  pi.on("tool_call", async (event: { toolName: string; input: Record<string, unknown> }, ctx: any) => {
    // If strict mode is active, auto-deny all security checks
    if (strictMode) {
      return {
        block: true,
        reason: "Blocked by the User: Strict mode active",
      };
    }

    // If allow-all is active, skip checks
    if (allowAllUntilInput) {
      return undefined;
    }

    // Only check write, edit, and bash tools (skip read)
    if (!["write", "edit", "bash"].includes(event.toolName)) {
      return undefined;
    }

    // Skip path permission checks for read-only bash commands (ls, find, cat, grep, etc.)
    const isReadOnlyBash =
      event.toolName === "bash" &&
      isReadOnlyCommand(event.input.command as string);

    // Get target path
    let targetPath: string | null = null;

    if (event.toolName === "bash") {
      targetPath = getToolTargetPath(event);
      // For bash without explicit paths, we'll just check for dangerous patterns
    } else if (event.input?.path) {
      targetPath = event.input.path as string;
    } else {
      return undefined;
    }

    // Resolve workspace path
    const workspace = ctx.cwd;
    const escapedPaths: string[] = [];

    // Check if path is outside workspace
    if (targetPath && !isReadOnlyBash) {
      // Resolve relative paths and expand ~
      const expandedPath = resolveTargetPath(targetPath, workspace).replace(/^~/, os.homedir());
      if (isPathOutsideWorkspace(expandedPath, workspace)) {
        escapedPaths.push(targetPath);
      }
    }

    // For bash, also check all paths in the command (skip for read-only commands)
    if (event.toolName === "bash" && !isReadOnlyBash) {
      const command = event.input.command as string;
      const allPaths = extractPathsFromCommand(command);
      for (const p of allPaths) {
        const expanded = resolveTargetPath(p, workspace).replace(/^~/, os.homedir());
        if (isPathOutsideWorkspace(expanded, workspace)) {
          if (!escapedPaths.includes(p)) {
            escapedPaths.push(p);
          }
        }
      }
    }

    // Check for dangerous patterns in bash commands (still apply to read-only commands)
    const isDangerous =
      event.toolName === "bash" &&
      !config.skipDangerousCheck &&
      containsDangerousPattern(event.input.command as string, config.dangerousPatterns || []);

    // Block without UI
    if (!ctx.hasUI) {
      if (isDangerous) {
        return {
          block: true,
          reason: "Blocked by the User: Dangerous command (no UI for confirmation)",
        };
      }
      return undefined;
    }

    // Show confirmation dialog
    const warnings: string[] = [];

    if (escapedPaths.length > 0 && !isReadOnlyBash) {
      warnings.push(`📁 Paths outside workspace:\n    ${escapedPaths.join(", ")}`);
    }

    if (isDangerous) {
      warnings.push(`⚠️ Dangerous pattern detected:\n    ${event.input.command}`);
    }

    if (warnings.length === 0) {
      return undefined;
    }
    const fullMessage = `🔒 Security Check Required\n\n${warnings.join("\n\n")}\n\nAllow?`;

    const choice = await ctx.ui.select(fullMessage, ["Allow", "Block", "Allow All (this turn)"]);


    if (choice === "Block" || choice === undefined) {
      // For read-only commands with path warnings, just allow them (don't block)
      if (isReadOnlyBash && escapedPaths.length > 0) {
        ctx.ui.notify("Read-only command allowed (path outside workspace)", "info");
        return undefined;
      }
      const reason = escapedPaths.length > 0 && !isReadOnlyBash
        ? `Blocked by the User: Path(s) outside workspace: ${escapedPaths.join(", ")}`
        : "Blocked by the User: Dangerous command";
      return { block: true, reason };
    }

    if (choice === "Allow All (this turn)") {
      allowAllUntilInput = true;
      ctx.ui.notify("Allow All activated - sandbox paused until next input", "info");
    }

    // User allowed it
    ctx.ui.notify("Command allowed", "info");
    return undefined;
  });

  // Reset allow-all and strict mode when user sends new input
  pi.on("input", async (_event: unknown, _ctx: unknown) => {
    allowAllUntilInput = false;
    strictMode = false;
  });
}