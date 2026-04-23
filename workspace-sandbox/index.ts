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

// Auto-detect extension script folders
function getExtensionScriptDirs(): string[] {
  const extensionsDir = path.join(os.homedir(), ".pi", "agent", "extensions");
  const scriptDirs: string[] = [];
  try {
    const { readdirSync } = require("node:fs");
    const entries = readdirSync(extensionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const scriptsPath = path.join(extensionsDir, entry.name, "scripts");
        try {
          readdirSync(scriptsPath);
          scriptDirs.push(scriptsPath);
        } catch {
          // No scripts folder
        }
      }
    }
  } catch {
    // Extensions dir doesn't exist
  }
  return scriptDirs;
}

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

  // --- Helpers ---
  function resolveHome(p: string): string {
    if (p.startsWith("~")) {
      return path.join(os.homedir(), p.slice(1));
    }
    return p;
  }

  function isWindowsDrive(pathStr: string): boolean {
    return /^[A-Za-z]:/.test(pathStr);
  }

  function isSameDrive(p1: string, p2: string): boolean {
    const drive1 = p1.match(/^[A-Za-z]:/)?.[0] ?? "";
    const drive2 = p2.match(/^[A-Za-z]:/)?.[0] ?? "";
    return drive1.toLowerCase() === drive2.toLowerCase();
  }

  function normalizeGitBashPath(p: string): string {
    // Convert Git Bash style paths (/c/...) to Windows paths (C:/...)
    const match = p.match(/^\/([a-zA-Z])(\/|$)/);
    if (match) {
      return `${match[1].toUpperCase()}:${p.slice(2)}`;
    }
    return p;
  }

  function resolveTargetPath(targetPath: string, workspace: string): string {
    // Normalize Git Bash style paths first
    const normalized = normalizeGitBashPath(targetPath);
    
    // Resolve relative paths against the workspace
    if (!path.isAbsolute(normalized)) {
      return path.resolve(workspace, normalized);
    }
    return normalized;
  }

  function isPathOutsideWorkspace(targetPath: string, workspace: string): boolean {
    // Normalize Git Bash style paths first
    const normalizedTarget = normalizeGitBashPath(targetPath);
    
    // Resolve relative paths and expand ~ against the workspace
    const resolved = resolveHome(path.normalize(resolveTargetPath(normalizedTarget, workspace)));
    const workspaceResolved = resolveHome(path.normalize(workspace));

    // Normalize path separators for comparison
    const normalized = resolved.replace(/\\/g, "/");
    const workspaceNormalized = workspaceResolved.replace(/\\/g, "/");

    // On Windows, different drives are always "outside"
    if (isWindowsDrive(resolved) && isWindowsDrive(workspaceResolved)) {
      if (!isSameDrive(resolved, workspaceResolved)) {
        return true; // Different drives = outside
      }
    }

    // Check if path starts with workspace (it's inside or equal)
    if (normalized.startsWith(workspaceNormalized + "/") || normalized === workspaceNormalized) {
      return false;
    }

    // Allow extension script directories
    const scriptDirs = getExtensionScriptDirs();
    for (const scriptDir of scriptDirs) {
      const scriptDirNormalized = scriptDir.replace(/\\/g, "/");
      if (normalized.startsWith(scriptDirNormalized + "/") || normalized === scriptDirNormalized) {
        return false;
      }
    }

    // Also check if target is a parent of workspace (shouldn't normally happen, but block it)
    if (workspaceNormalized.startsWith(normalized + "/")) {
      return true;
    }

    return true; // Outside
  }

  function extractPathsFromCommand(command: string): string[] {
    const paths: string[] = [];

    // Match quoted strings (single or double) - only if they look like actual paths
    const quoted = command.match(/['"]([^'"]+)['"]/g) || [];
    quoted.forEach((q) => {
      const candidate = q.slice(1, -1);
      // Only add if it looks like a real path (starts with /, ~, or drive letter)
      if (/^(\/|~|([A-Za-z]:\\|[A-Za-z]:\/))/.test(candidate)) {
        paths.push(candidate);
      }
    });

    // Common path patterns after commands (Unix)
    // Only capture actual paths (starting with /, ~, or Windows drive letter), not flags/values
    const unixPathPatterns = [
      /\b(cd|mkdir|mv|rm|ls|cat|touch|chmod|chown|scp|rsync|find)\s+(\/[^\s;|&><]+|~[^\s;|&><]+|[A-Za-z]:[^\s;|&><]+)/gi,
      // cp/mv with two paths (source then destination)
      /\b(cp|mv)\s+(\/[^\s;|&><]+|~[^\s;|&><]+|[A-Za-z]:[^\s;|&><]+)\s+(\/[^\s;|&><]+|~[^\s;|&><]+|[A-Za-z]:[^\s;|&><]+)/gi,
      /\b(ssh|sftp)\s+([^-][^\s;|&]+)/gi,
      /-o\s+([^=]+)/g, // SSH options
      /--out-dir\s+([^\s]+)/g,
      /-C\s+([^\s]+)/g,
    ];

    // Windows command patterns
    const winPathPatterns = [
      /\b(cd|chdir|mkdir|md|move|copy|del|rmdir|dir|type|attrib)\s+([^-][^\s;|&><]+)/gi,
      /\\\\([^\s;|&><]+)/g, // UNC paths
      /([A-Za-z]:\\[^\s;|&><]+)/g, // Drive letter paths
    ];

    // PowerShell cmdlet patterns for write/destructive operations
    const psCmdletPatterns = [
      // New-Item -Path <path> [-ItemType File|Directory]
      /New-Item\s+-Path\s+([^-][^\s;|&><]+)/gi,
      // Set-Content, Add-Content -Path <path> or first positional
      /(?:Set-Content|Add-Content|Out-File)\s+-Path\s+([^-][^\s;|&><]+)/gi,
      /\b(Set-Content|Add-Content|Out-File)\s+([^-][^\s;|&><]+)/gi,
      // Copy-Item, Move-Item, Remove-Item -Path <path>
      /(?:Copy-Item|Move-Item|Remove-Item|Rename-Item)\s+-Path\s+([^-][^\s;|&><]+)/gi,
      // General -Destination parameter (allows other params before it)
      /(?:Copy-Item|Move-Item|Compress-Archive|Expand-Archive|Tee-Object)\s+.*-Destination(?:Path)?\s+([^-][^\s;|&><]+)/gi,
      // Get-Content (read-only)
      /Get-Content\s+-Path\s+([^-][^\s;|&><]+)/gi,
      // Invoke-WebRequest/Invoke-RestMethod -OutFile <path>
      /(?:Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\s+-OutFile\s+([^-][^\s;|&><]+)/gi,
      // OutFile parameter (for any cmdlet)
      /-OutFile\s+([^-][^\s;|&><]+)/gi,
      // Start-Process -FilePath <path> or with > redirect
      /Start-Process\s+-FilePath\s+([^-][^\s;|&><]+)/gi,
      // Export-Csv, Export-Clixml, Export-ModuleMember
      /Export-(?:Csv|Clixml|ModuleMember)\s+-Path\s+([^-][^\s;|&><]+)/gi,
      // Import-Module <path>
      /Import-Module\s+([^-][^\s;|&><]+)/gi,
      // ConvertTo-Json/ConvertFrom-Json with -Path
      /ConvertTo-(?:Json|Xml|Yaml)\s+-Path\s+([^-][^\s;|&><]+)/gi,
      // Tee-Object -FilePath
      /Tee-Object\s+-FilePath\s+([^-][^\s;|&><]+)/gi,
    ];

    [...unixPathPatterns, ...winPathPatterns, ...psCmdletPatterns].forEach((re) => {
      let match;
      while ((match = re.exec(command)) !== null) {
        // For patterns with multiple capture groups (like cp src dest), extract all path groups
        for (let i = 1; i < match.length; i++) {
          const candidate = match[i];
          if (candidate && !candidate.startsWith("-") && candidate.length > 1) {
            paths.push(candidate.replace(/['"]/g, ""));
          }
        }
      }
    });

    return paths;
  }

  function containsDangerousPattern(command: string, patterns: string[]): boolean {
    // Normalize: collapse whitespace and lowercase for matching
    const normalized = command.replace(/\s+/g, " ").toLowerCase();
    return patterns.some((p) => normalized.includes(p.toLowerCase()));
  }

  function getToolTargetPath(event: any): string | null {
    if (event.toolName === "write" || event.toolName === "edit" || event.toolName === "read") {
      return event.input.path as string;
    }
    if (event.toolName === "bash") {
      const command = event.input.command as string;
      const paths = extractPathsFromCommand(command);
      return paths[0] || null;
    }
    return null;
  }

  // Reset allow-all and strict mode when user sends new input
  pi.on("input", async (_event: unknown, _ctx: unknown) => {
    allowAllUntilInput = false;
    strictMode = false;
  });

  // Safe read-only bash commands that don't need path permission checks
  const READ_ONLY_COMMANDS = new Set([
    "ls", "dir", "cat", "find", "grep", "head", "tail", "wc", "stat",
    "type", "more", "less", "xdg-open", "code", "open", "echo", "pwd",
    "findstr", "rg"
  ]);

  function isReadOnlyCommand(command: string): boolean {
    const trimmed = command.trim();
    // Check for pipes and redirects to see if it's just read operations
    const parts = trimmed.split(/[|&;]/);
    const firstCmd = parts[0].trim().split(/\s+/)[0].toLowerCase();
    return READ_ONLY_COMMANDS.has(firstCmd);
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
}
