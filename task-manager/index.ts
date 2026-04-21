/**
 * Task Manager Extension for Pi
 * 
 * Manages tasks via PowerShell scripts that operate on MD files.
 * - Blocks direct access to ~/.pi/tasks/ folder
 * - Provides CRUD tools and commands for task management
 * - Enforces single-active task policy with user confirmation
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { Text } from "@mariozechner/pi-tui";

const VERSION = "0.1.3";
const execAsync = promisify(exec);
const TASKS_ROOT = resolve(process.env.HOME || process.env.USERPROFILE || "", ".pi", "tasks");

/**
 * Register message renderer for task entries
 */
function registerTaskRenderer(pi: ExtensionAPI): void {
    pi.registerMessageRenderer("task", (message, options, theme) => {
        const { expanded } = options;
        const taskName = (message.details as { name?: string })?.name || "Task";
        
        let header = theme.fg("accent", `📋 ${taskName}`);
        let body = message.content;
        
        if (expanded && message.details) {
            body += "\n" + theme.fg("dim", JSON.stringify(message.details, null, 2));
        }
        
        return new Text(`${header}\n\n${body}`, 1, 1);
    });
}

/**
 * Get workspace name from cwd (e.g., "C:/temp" -> "C-temp")
 */
function getWorkspaceName(cwd: string): string {
    // Normalize path: remove duplicate slashes, trailing slashes
    const normalized = cwd.replace(/\\+/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
    // Replace drive letter colon and path separators with dashes
    return normalized.replace(/[:\/]/g, "-").replace(/^-+|-+$/g, "");
}

interface TaskInfo {
    id: string;
    title: string;
    priority: string;
    created: string;
    folder: string;
    path?: string;
}

interface ListResult {
    folder: string;
    tasks: TaskInfo[];
}

// Define the params schema type for type safety
const TasksParamsSchema = Type.Object({
    action: Type.Union([
        Type.Literal("list"),
        Type.Literal("move"),
        Type.Literal("append"),
        Type.Literal("delete"),
        Type.Literal("rename"),
        Type.Literal("search"),
        Type.Literal("get"),
    ]),
    name: Type.Optional(Type.String({ description: "Task name (partial match supported)" })),
    folder: Type.Optional(Type.String({ description: "Target folder: Backlog, Active, Closed" })),
    content: Type.Optional(Type.String({ description: "Content to append to task (for append action)" })),
    newTitle: Type.Optional(Type.String({ description: "New title (for rename action)" })),
});
type TasksParams = Static<typeof TasksParamsSchema>;

/**
 * Parse PowerShell output into structured task data
 */
async function listTasks(workspace: string, folder: string): Promise<TaskInfo[]> {
    const scriptPath = resolve(__dirname, "scripts", "list-tasks.ps1");
    const { stdout } = await execAsync(
        `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -Workspace "${workspace}" -Folder "${folder}"`,
        { encoding: "utf8" }
    );
    
    if (!stdout.trim()) return [];
    
    return stdout.trim().split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => {
            const [id, title, priority, created] = line.split("\t");
            return { id: id || "", title: title || "Untitled", priority: priority || "medium", created: created || "", folder };
        });
}

/**
 * Get all tasks across folders for a workspace
 */
async function getAllTasks(workspace: string): Promise<ListResult[]> {
    return Promise.all(["Backlog", "Active", "user-qa", "Closed"].map(async folder => ({
        folder,
        tasks: await listTasks(workspace, folder)
    })));
}

/**
 * Get full task file content by scanning the directory
 */
async function getTaskContent(workspace: string, name: string): Promise<string | null> {
    // Build list of folders to search
    for (const folder of ["Backlog", "Active", "user-qa", "Closed"]) {
        const folderPath = resolve(TASKS_ROOT, workspace, folder);
        
        // List files in the folder
        const { readdir } = await import("node:fs/promises");
        let files: string[];
        try {
            files = await readdir(folderPath);
        } catch {
            continue;
        }
        
        // Find matching file
        const nameLower = name.toLowerCase().replace(/\s+/g, "-");
        for (const file of files) {
            if (!file.endsWith(".md")) continue;
            
            // Check if filename starts with the normalized task name
            if (file.toLowerCase().startsWith(nameLower)) {
                const filePath = resolve(folderPath, file);
                try {
                    const { readFile } = await import("node:fs/promises");
                    return await readFile(filePath, "utf8");
                } catch {
                    continue;
                }
            }
        }
    }
    return null;
}

/**
 * Run a PowerShell script with the given arguments
 * Uses -Command with call operator (&) to properly handle arguments with spaces
 */
async function runScript(script: string, workspace: string, args: Record<string, string | undefined>): Promise<string> {
    const scriptPath = resolve(__dirname, "scripts", `${script}.ps1`);
    const allArgs = { Workspace: workspace, ...args };
    
    // Build argument list with proper quoting for PowerShell
    // Single quotes in values are escaped as doubled ('')
    const escapedArgs = Object.entries(allArgs)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => `-${k} '${String(v).replace(/'/g, "''")}'`)
        .join(' ');
    
    // Use call operator (&) with -Command for proper argument handling
    const cmd = `powershell -ExecutionPolicy Bypass -NoProfile -Command "& '${scriptPath.replace(/'/g, "''")}' ${escapedArgs}"`;
    
    const { stdout, stderr } = await execAsync(cmd, { encoding: "utf8" });
    
    if (stderr && !stdout) {
        throw new Error(stderr);
    }
    return stdout.trim();
}

/**
 * Find a task by name prefix (fuzzy match)
 */
async function findTask(workspace: string, name: string): Promise<TaskInfo | null> {
    const allTasks = await getAllTasks(workspace);
    const nameLower = name.toLowerCase();
    
    for (const result of allTasks) {
        for (const task of result.tasks) {
            if (task.title.toLowerCase().startsWith(nameLower) || 
                task.title.toLowerCase().replace(/\s+/g, "-").startsWith(nameLower)) {
                return task;
            }
        }
    }
    
    // Partial match
    for (const result of allTasks) {
        for (const task of result.tasks) {
            if (task.title.toLowerCase().includes(nameLower)) {
                return task;
            }
        }
    }
    
    return null;
}

/**
 * Find all tasks matching a name (for disambiguation)
 */
async function findAllMatching(workspace: string, name: string): Promise<TaskInfo[]> {
    const allTasks = await getAllTasks(workspace);
    const nameLower = name.toLowerCase();
    const matches: TaskInfo[] = [];
    
    for (const result of allTasks) {
        for (const task of result.tasks) {
            const normalized = task.title.toLowerCase().replace(/\s+/g, "-");
            if (task.title.toLowerCase().includes(nameLower) || normalized.includes(nameLower)) {
                matches.push(task);
            }
        }
    }
    
    return matches;
}

export default function (pi: ExtensionAPI) {
    // Register task message renderer
    registerTaskRenderer(pi);
    
    // Session start: notify about active tasks
    pi.on("session_start", async (_event, ctx) => {
        const workspace = getWorkspaceName(ctx.cwd);
        const activeTasks = (await listTasks(workspace, "Active"));
        
        if (activeTasks.length === 0) {
            // No active tasks - check backlog
            const backlogTasks = (await listTasks(workspace, "Backlog"));
            if (backlogTasks.length > 0) {
                ctx.ui.notify(`You have ${backlogTasks.length} task(s) in Backlog. Use /tasks to view.`, "info");
            }
        } else if (activeTasks.length === 1) {
            ctx.ui.notify(`Active task: "${activeTasks[0].title}"`, "info");
        } else {
            const titles = activeTasks.map(t => `"${t.title}"`).join(", ");
            ctx.ui.notify(`${activeTasks.length} active tasks: ${titles}`, "info");
            ctx.ui.confirm("Multiple Active", "Would you like to manage active tasks?");
        }
    });

    // Permission gate: block writes to tasks folder, allow reads
    pi.on("tool_call", async (event, ctx) => {
        const toolName = event.toolName;
        
        // Only block write/edit/bash to tasks folder, allow read
        if (["write", "edit", "bash"].includes(toolName)) {
            let path: string | undefined;
            
            if (toolName === "bash" && "command" in event.input) {
                path = event.input.command as string | undefined;
            } else if ("path" in event.input) {
                path = event.input.path as string | undefined;
            }
            
            if (path) {
                const resolved = resolve(ctx.cwd, path);
                if (resolved.startsWith(TASKS_ROOT) || resolved.replace(/\\/g, "/").startsWith(TASKS_ROOT.replace(/\\/g, "/"))) {
                    const ok = await ctx.ui.confirm(
                        "Task Access",
                        `Block attempt to access tasks folder directly. Use task tools instead?`
                    );
                    if (!ok) return;
                    ctx.ui.notify("Use task tools (/tasks, /task) for task management", "info");
                    return { block: true, reason: "Tasks must be managed via task tools" };
                }
            }
        }
    });

    // Register task tool
    pi.registerTool({
        name: "tasks",
        label: "Tasks",
        description: "Manage tasks. Actions: list (show all), move (change folder), append (add content), delete, rename, search (find by name)",
        promptSnippet: "Manage project tasks via task tools",
        promptGuidelines: ["Use task tools when asked to work with tasks, list tasks, or assign work"],
        parameters: TasksParamsSchema as any,

        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const p = params as TasksParams;
            const workspace = getWorkspaceName(ctx.cwd);
            try {
                switch (p.action) {
                    case "list": {
                        const allTasks = await getAllTasks(workspace);
                        let output = "";
                        for (const result of allTasks) {
                            if (result.tasks.length > 0) {
                                output += `\n## ${result.folder} (${result.tasks.length})\n`;
                                for (const task of result.tasks) {
                                    output += `- **${task.title}** [${task.priority}] ${task.id.substring(0, 8)}\n`;
                                }
                            }
                        }
                        return {
                            content: [{ type: "text", text: output || "No tasks found" }],
                            details: { action: "list", tasks: await getAllTasks(workspace) }
                        };
                    }

                    case "move": {
                        if (!p.name || !p.folder) {
                            return {
                                content: [{ type: "text", text: "Error: name and folder required for move" }],
                                details: { error: "missing parameters" }
                            };
                        }

                        // Check if moving to Active and there's already an active task
                        if (p.folder === "Active") {
                            const activeTasks = await listTasks(workspace, "Active");
                            if (activeTasks.length > 0) {
                                const current = await findTask(workspace, p.name);
                                if (!current || current.folder !== "Active") {
                                    const proceed = await ctx.ui.confirm(
                                        "Active Task Exists",
                                        `Move "${activeTasks[0].title}" to Backlog and set "${p.name}" to Active?`
                                    );
                                    if (!proceed) {
                                        return {
                                            content: [{ type: "text", text: "Cancelled: keeping current active task" }],
                                            details: { action: "move", cancelled: true }
                                        };
                                    }
                                    // Move current active to backlog first
                                    await runScript("move-task", workspace, { Name: activeTasks[0].title, NewFolder: "Backlog" });
                                }
                            }
                        }

                        const result = await runScript("move-task", workspace, { Name: p.name, NewFolder: p.folder });
                        return {
                            content: [{ type: "text", text: `Moved "${p.name}" to ${p.folder}` }],
                            details: { action: "move", result }
                        };
                    }

                    case "append": {
                        if (!p.name || !p.content) {
                            return {
                                content: [{ type: "text", text: "Error: name and content required for append" }],
                                details: { error: "missing parameters" }
                            };
                        }
                        await runScript("append-task", workspace, { Name: p.name, Content: p.content });
                        return {
                            content: [{ type: "text", text: `Added to "${p.name}"` }],
                            details: { action: "append" }
                        };
                    }

                    case "delete": {
                        if (!p.name) {
                            return {
                                content: [{ type: "text", text: "Error: name required for delete" }],
                                details: { error: "missing parameters" }
                            };
                        }
                        const folder = await runScript("delete-task", workspace, { Name: p.name });
                        return {
                            content: [{ type: "text", text: `Deleted "${p.name}" from ${folder}` }],
                            details: { action: "delete", folder }
                        };
                    }

                    case "rename": {
                        if (!p.name || !p.newTitle) {
                            return {
                                content: [{ type: "text", text: "Error: name and newTitle required for rename" }],
                                details: { error: "missing parameters" }
                            };
                        }
                        const folder = await runScript("rename-task", workspace, { Name: p.name, NewTitle: p.newTitle });
                        return {
                            content: [{ type: "text", text: `Renamed to "${p.newTitle}" (${folder})` }],
                            details: { action: "rename", folder }
                        };
                    }

                    case "search": {
                        if (!p.name) {
                            return {
                                content: [{ type: "text", text: "Error: name required for search" }],
                                details: { error: "missing parameters" }
                            };
                        }
                        const task = await findTask(workspace, p.name);
                        if (!task) {
                            return {
                                content: [{ type: "text", text: `No task found matching "${p.name}"` }],
                                details: { action: "search", found: false }
                            };
                        }
                        return {
                            content: [{ type: "text", text: `Found: **${task.title}** in ${task.folder} [${task.priority}]` }],
                            details: { action: "search", found: true, task }
                        };
                    }

                    case "get": {
                        if (!p.name) {
                            return {
                                content: [{ type: "text", text: "Error: name required for get" }],
                                details: { error: "missing parameters" }
                            };
                        }
                        const task = await findTask(workspace, p.name);
                        if (!task) {
                            return {
                                content: [{ type: "text", text: `No task found matching "${p.name}"` }],
                                details: { action: "get", found: false }
                            };
                        }
                        const output = await runScript("append-task", workspace, { Name: p.name });
                        return {
                            content: [{ type: "text", text: output }],
                            details: { action: "get", task }
                        };
                    }

                    default:
                        return {
                            content: [{ type: "text", text: `Unknown action: ${p.action}` }],
                            details: { error: "unknown action" }
                        };
                }
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
                    details: { error: String(error) }
                };
            }
        },
    });

    // Register /tasks command - list all tasks
    pi.registerCommand("tasks", {
        description: "List all tasks by folder",
        async handler(_args, ctx) {
            const workspace = getWorkspaceName(ctx.cwd);
            if (!ctx.hasUI) {
                const allTasks = await getAllTasks(workspace);
                let output = "Tasks:\n";
                for (const result of allTasks) {
                    if (result.tasks.length > 0) {
                        output += `\n${result.folder}:\n`;
                        for (const task of result.tasks) {
                            output += `  - ${task.title} [${task.priority}]\n`;
                        }
                    }
                }
                ctx.ui.notify(output || "No tasks", "info");
                return;
            }

            // Interactive picker
            const allTasks = await getAllTasks(workspace);
            const items: { value: string; label: string }[] = [];
            
            for (const result of allTasks) {
                for (const task of result.tasks) {
                    items.push({
                        value: `${result.folder}:${task.title}`,
                        label: `[${result.folder}] ${task.title}`
                    });
                }
            }

            if (items.length === 0) {
                ctx.ui.notify("No tasks found", "info");
                return;
            }

            const choice = await ctx.ui.select("Tasks", items.map(i => i.label));
            if (!choice) {
                ctx.ui.notify("Cancelled", "info");
                return;
            }

            // Find selected task and output its content
            const selected = items.find(i => i.label === choice);
            if (selected) {
                const taskName = selected.value.split(":")[1];
                const content = await getTaskContent(workspace, taskName);
                if (content) {
                    // Display the task content as a message in the conversation
                    pi.sendMessage({
                        customType: "task",
                        content: content,
                        display: true,
                        details: { name: taskName }
                    }, { deliverAs: "steer" });
                } else {
                    ctx.ui.notify(`Could not read task "${taskName}"`, "error");
                }
            }
        },
    });

    // Register /task command - assign a task to Active
    pi.registerCommand("task", {
        description: "Assign a task to Active (use /task <name>)",
        async handler(args, ctx) {
            const workspace = getWorkspaceName(ctx.cwd);
            
            if (!args) {
                // Show active task
                const activeTasks = await listTasks(workspace, "Active");
                if (activeTasks.length > 0) {
                    ctx.ui.notify(`Active: "${activeTasks[0].title}"`, "info");
                } else {
                    ctx.ui.notify("No active task. Use /task <name> to assign one.", "info");
                }
                return;
            }

            // Find tasks matching the input
            const matches = await findAllMatching(workspace, args);
            
            // Check for exact match (case-insensitive, normalized)
            const exactMatch = matches.find(m => 
                m.title.toLowerCase() === args.toLowerCase() ||
                m.title.toLowerCase().replace(/\s+/g, "-") === args.toLowerCase().replace(/\s+/g, "-")
            );
            
            if (exactMatch) {
                // Exact match found - select directly
                const title = exactMatch.title;
                
                // Auto-switch active task
                const activeTasks = await listTasks(workspace, "Active");
                if (activeTasks.length > 0) {
                    await runScript("move-task", workspace, { Name: activeTasks[0].title, NewFolder: "Backlog" });
                }
                await runScript("move-task", workspace, { Name: title, NewFolder: "Active" });
                ctx.ui.notify(`Now active: "${title}"`, "info");
                return;
            }
            
            if (matches.length === 0) {
                ctx.ui.notify(`No task found matching "${args}". Use /task-new to create one.`, "error");
                return;
            }
            
            // No exact match - show disambiguation list
            const items: { value: string; label: string }[] = [];
            for (const task of matches) {
                items.push({
                    value: task.title,
                    label: `[${task.folder}] ${task.title}`
                });
            }

            const choice = await ctx.ui.select(`${matches.length} tasks matching "${args}":`, items.map(i => i.label));
            if (!choice) {
                ctx.ui.notify("Cancelled", "info");
                return;
            }

            const selected = items.find((_, i) => items[i].label === choice);
            if (selected) {
                const title = selected.value;
                
                // Auto-switch active task
                const activeTasks = await listTasks(workspace, "Active");
                if (activeTasks.length > 0) {
                    await runScript("move-task", workspace, { Name: activeTasks[0].title, NewFolder: "Backlog" });
                }
                await runScript("move-task", workspace, { Name: title, NewFolder: "Active" });
                ctx.ui.notify(`Now active: "${title}"`, "info");
            }
        },
    });

    // Register /task-new command - create a new task
    pi.registerCommand("task-new", {
        description: "Create a new task (use /task-new <title> [--priority=high])",
        async handler(args, ctx) {
            const workspace = getWorkspaceName(ctx.cwd);
            if (!args) {
                ctx.ui.notify("Usage: /task-new <title> [--priority=low|medium|high|critical]", "info");
                return;
            }

            // Parse priority from args if present
            let title = args;
            let priority = "medium";
            const priorityMatch = args.match(/--priority=(\w+)/);
            if (priorityMatch) {
                priority = priorityMatch[1];
                title = args.replace(/--priority=\w+\s*/, "");
            }

            const id = await runScript("create-task", workspace, { Title: title, Priority: priority });
            ctx.ui.notify(`Created task "${title}" (${id.substring(0, 8)})`, "info");
        },
    });

    // Register /task-complete command - mark task as completed by user QA
    pi.registerCommand("task-complete", {
        description: "Mark a task as complete (use /task-complete <name>)",
        async handler(args, ctx) {
            const workspace = getWorkspaceName(ctx.cwd);
            if (!args) {
                ctx.ui.notify("Usage: /task-complete <task-name>", "info");
                return;
            }

            // Find tasks matching the input
            const matches = await findAllMatching(workspace, args);
            
            // Check for exact match
            const exactMatch = matches.find(m => 
                m.title.toLowerCase() === args.toLowerCase() ||
                m.title.toLowerCase().replace(/\s+/g, "-") === args.toLowerCase().replace(/\s+/g, "-")
            );
            
            if (exactMatch) {
                // Exact match found - process directly
                const title = exactMatch.title;
                
                // Move to user-qa folder
                await runScript("move-task", workspace, { Name: title, NewFolder: "user-qa" });
                
                // Append completion note
                const qaNote = `\n## User QA\nTask has finished user QA testing.`;
                await runScript("append-task", workspace, { Name: title, Content: qaNote });
                
                ctx.ui.notify(`Moved "${title}" to user-qa`, "info");
                return;
            }
            
            if (matches.length === 0) {
                ctx.ui.notify(`No task found matching "${args}"`, "error");
                return;
            }
            
            // No exact match - show disambiguation list
            const items: { value: string; label: string }[] = [];
            for (const task of matches) {
                items.push({
                    value: task.title,
                    label: `[${task.folder}] ${task.title}`
                });
            }

            const choice = await ctx.ui.select(`${matches.length} tasks matching "${args}":`, items.map(i => i.label));
            if (!choice) {
                ctx.ui.notify("Cancelled", "info");
                return;
            }

            const selected = items.find((_, i) => items[i].label === choice);
            if (selected) {
                const title = selected.value;
                
                // Move to user-qa folder
                await runScript("move-task", workspace, { Name: title, NewFolder: "user-qa" });
                
                // Append completion note
                const qaNote = `\n## User QA\nTask has finished user QA testing.`;
                await runScript("append-task", workspace, { Name: title, Content: qaNote });
                
                ctx.ui.notify(`Moved "${title}" to user-qa`, "info");
            }
        },
    });
}