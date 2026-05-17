# Workspace Sandbox

Prompts for permission when `bash`/`write`/`edit` commands target paths outside the current working directory. 
Prompts for confirmation when running "dangerous" commands.

## Purpose

This extension prevents accidental file system access outside the workspace by:
- Blocking `write`, `edit`, and `bash` operations targeting paths outside the current working directory
- Detecting dangerous commands (e.g., `rm -rf`, `sudo`, `git push`)
- Prompting for user confirmation before allowing restricted operations

## Settings

```json
{
  "workspaceSandbox": {
    "allowedDirs": ["~/projects/shared"],
    "skipDangerousCheck": false,
    "dangerousPatterns": ["rm -rf", "sudo"]
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `allowedDirs` | `[]` | Extra allowed directories |
| `skipDangerousCheck` | `false` | Skip dangerous command detection |
| `dangerousPatterns` | `rm -rf`, `sudo`, `mkfs`, etc. | Blocked patterns |

**Environment variable override:**
```bash
export PI_WORKSPACE_ALLOWED_DIRS="~/projects/shared,~/documents"
```

## Commands

| Command | Description |
|---------|-------------|
| `/sandbox status` | Show status and active patterns |
| `/sandbox allow` | Disable sandbox until next input |
| `/sandbox strict` | Re-enable sandbox |
| `/sandbox dangerous` | List dangerous patterns |

## Security

- Extension script directories (`.pi/agent/extensions/*/scripts`) are automatically allowed
- Different Windows drives always blocked
- No-UI mode: blocked operations return error with reason
