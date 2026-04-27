/**
 * Internal pure functions for workspace sandbox extension.
 * These functions are extracted for direct unit testing.
 */

import os from "node:os";
import path from "node:path";

// ============================================================================
// Path Helpers
// ============================================================================

/**
 * Check if a path starts with a Windows drive letter (e.g., C: or D:).
 */
export function isWindowsDrive(pathStr: string): boolean {
  return /^[A-Za-z]:/.test(pathStr);
}

/**
 * Check if two paths are on the same Windows drive (case-insensitive).
 */
export function isSameDrive(p1: string, p2: string): boolean {
  const drive1 = p1.match(/^[A-Za-z]:/)?.[0] ?? "";
  const drive2 = p2.match(/^[A-Za-z]:/)?.[0] ?? "";
  return drive1.toLowerCase() === drive2.toLowerCase();
}

/**
 * Normalize Git Bash style paths (e.g., /c/... or /d/...) to Windows paths (C:/...).
 */
export function normalizeGitBashPath(p: string): string {
  const match = p.match(/^\/([a-zA-Z])(\/|$)/);
  if (match) {
    return `${match[1].toUpperCase()}:${p.slice(2)}`;
  }
  return p;
}

/**
 * Resolve ~ to the home directory.
 */
export function resolveHome(p: string): string {
  if (p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/**
 * Resolve a target path relative to workspace.
 * Handles Git Bash paths, relative paths, and absolute paths.
 */
export function resolveTargetPath(targetPath: string, workspace: string): string {
  // Normalize Git Bash style paths first
  const normalized = normalizeGitBashPath(targetPath);

  // Resolve relative paths against the workspace
  if (!path.isAbsolute(normalized)) {
    return path.resolve(workspace, normalized);
  }
  return normalized;
}

/**
 * Auto-detect extension script folders from the .pi/agent/extensions directory.
 */
export function getExtensionScriptDirs(): string[] {
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

/**
 * Check if a target path is outside the workspace.
 */
export function isPathOutsideWorkspace(targetPath: string, workspace: string): boolean {
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

// ============================================================================
// Command Parser
// ============================================================================

/**
 * Safe read-only bash commands that don't need path permission checks.
 */
export const READ_ONLY_COMMANDS = new Set([
  "ls", "dir", "cat", "find", "grep", "head", "tail", "wc", "stat",
  "type", "more", "less", "xdg-open", "code", "open", "echo", "pwd",
  "findstr", "rg"
]);

/**
 * Check if a command is read-only (doesn't modify files).
 */
export function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();
  // Check for pipes and redirects to see if it's just read operations
  const parts = trimmed.split(/[|&;]/);
  const firstCmd = parts[0].trim().split(/\s+/)[0].toLowerCase();
  return READ_ONLY_COMMANDS.has(firstCmd);
}

/**
 * Extract all paths from a bash command.
 */
export function extractPathsFromCommand(command: string): string[] {
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
    // Commands with single path argument (cd, mkdir, rm, ls, cat, etc.)
    /\b(cd|mkdir|rm|ls|cat|touch|chmod|chown|find)\s+(\/[^\s;|&><]+|~[^\s;|&><]+|[A-Za-z]:[^\s;|&><]+)/gi,
    // cp/mv with two paths (source then destination)
    /\b(cp|mv)\s+(\/[^\s;|&><]+|~[^\s;|&><]+|[A-Za-z]:[^\s;|&><]+)\s+(\/[^\s;|&><]+|~[^\s;|&><]+|[A-Za-z]:[^\s;|&><]+)/gi,
    // scp source path (user@host:/path or /path)
    /\bscp\s+((?:[a-zA-Z][a-zA-Z0-9._-]*@)?[a-zA-Z0-9._-]+:[^\s;|&><]+|\/[^\s;|&><]+|~[^\s;|&><]+)\s+\S+/gi,
    // scp destination path
    /\bscp\s+\S+\s+((?:[a-zA-Z][a-zA-Z0-9._-]*@)?[a-zA-Z0-9._-]+:[^\s;|&><]+|\/[^\s;|&><]+|~[^\s;|&><]+|[A-Za-z]:[^\s;|&><]+)/gi,
    // rsync paths
    /\brsync\s+((?:[a-zA-Z][a-zA-Z0-9._-]*@)?[a-zA-Z0-9._-]+:[^\s;|&><]+|\/[^\s;|&><]+|~[^\s;|&><]+)\s+\S+/gi,
    /\brsync\s+\S+\s+((?:[a-zA-Z][a-zA-Z0-9._-]*@)?[a-zA-Z0-9._-]+:[^\s;|&><]+|\/[^\s;|&><]+|~[^\s;|&><]+|[A-Za-z]:[^\s;|&><]+)/gi,
    // ssh/sftp: skip flags with optional values, capture user@host
    /\b(ssh|sftp)\s+(?:-\S+(?:\s+\S+)?\s+)*([a-zA-Z][a-zA-Z0-9._-]*@[a-zA-Z0-9._-]+)/gi,
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

/**
 * Check if a command contains any dangerous patterns.
 */
export function containsDangerousPattern(command: string, patterns: string[]): boolean {
  // Normalize: collapse whitespace and lowercase for matching
  const normalized = command.replace(/\s+/g, " ").toLowerCase();
  return patterns.some((p) => normalized.includes(p.toLowerCase()));
}

/**
 * Get the target path from a tool call event.
 * Returns null if no path can be extracted.
 */
export function getToolTargetPath(event: { toolName: string; input: Record<string, unknown> }): string | null {
  if (event.toolName === "write" || event.toolName === "edit" || event.toolName === "read") {
    return (event.input.path as string) || null;
  }
  if (event.toolName === "bash") {
    const command = event.input.command as string;
    const paths = extractPathsFromCommand(command);
    return paths[0] || null;
  }
  return null;
}