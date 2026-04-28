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
        Type.Literal("create"),
        Type.Literal("move"),
        Type.Literal("append"),
        Type.Literal("delete"),
        Type.Literal("rename"),
        Type.Literal("search"),
        Type.Literal("get"),
        Type.Literal("submit-qa"),
    ]),
    name: Type.Optional(Type.String({ description: "Task name (partial match supported)" })),
    folder: Type.Optional(Type.String({ description: "Target folder: Backlog, Active, Closed" })),
    content: Type.Optional(Type.String({ description: "Content to append to task (for append action)" })),
    newTitle: Type.Optional(Type.String({ description: "New title (for rename action)" })),
    title: Type.Optional(Type.String({ description: "Task title (for create action)" })),
    priority: Type.Optional(Type.Union([
        Type.Literal("low"),
        Type.Literal("medium"),
        Type.Literal("high"),
        Type.Literal("critical")
    ], { description: "Task priority (for create action), defaults to medium" })),
    message: Type.Optional(Type.String({ description: "QA submission message (for submit-qa action)" })),
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
 * Get tasks excluding Closed folder (for /tasks command)
 */
async function getOpenTasks(workspace: string): Promise<ListResult[]> {
    return Promise.all(["Backlog", "Active", "user-qa"].map(async folder => ({
        folder,
        tasks: await listTasks(workspace, folder)
    })));
}

/**
 * Find all tasks matching a name (for disambiguation)
 */
async function findAllMatching(workspace: string, name: string): Promise<TaskInfo[]> {
    const allTasks = await getAllTasks(workspace);
    const normalizedSearch = normalizeTaskName(name);
    const matches: TaskInfo[] = [];
    
    for (const result of allTasks) {
        for (const task of result.tasks) {
            const normalizedTitle = normalizeTaskName(task.title);
            if (normalizedTitle.startsWith(normalizedSearch) || normalizedTitle.includes(normalizedSearch)) {
                matches.push(task);
            }
        }
    }
    
    return matches;
}

/**
 * Find exact match (normalized) or return null
 */
async function findExactMatch(workspace: string, name: string): Promise<TaskInfo | null> {
    const matches = await findAllMatching(workspace, name);
    const normalizedSearch = normalizeTaskName(name);
    return matches.find(m => normalizeTaskName(m.title) === normalizedSearch) || null;
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
        const normalizedName = normalizeTaskName(name);
        for (const file of files) {
            if (!file.endsWith(".md")) continue;
            
            // Check if filename starts with the normalized task name
            const fileNameLower = file.toLowerCase();
            if (fileNameLower.startsWith(normalizedName) || fileNameLower.includes(normalizedName)) {
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
 * Content arguments are base64 encoded to avoid escaping issues
 * Switch parameters are passed as -Param (without value) when true
 */
async function runScript(script: string, workspace: string, args: Record<string, string | boolean | undefined>): Promise<string> {
    const scriptPath = resolve(__dirname, "scripts", `${script}.ps1`);
    
    const cmdParts: string[] = [];
    
    // Add workspace
    cmdParts.push(`-Workspace ([System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String('${Buffer.from(workspace, "utf16le").toString("base64")}')))`);
    
    // Add other args
    for (const [k, v] of Object.entries(args)) {
        if (v === undefined) continue;
        
        if (typeof v === "boolean" && v) {
            // Switch parameter - just add the flag
            cmdParts.push(`-${k}`);
        } else if (typeof v === "string") {
            // String parameter - base64 encode
            const encoded = Buffer.from(v, "utf16le").toString("base64");
            cmdParts.push(`-${k} ([System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String('${encoded}')))`);
        }
    }
    
    // Use call operator (&) with -Command for proper argument handling
    const cmd = `powershell -ExecutionPolicy Bypass -NoProfile -Command "& '${scriptPath.replace(/'/g, "''")}' ${cmdParts.join(' ')}"`;
    
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
    const normalizedSearch = normalizeTaskName(name);
    
    for (const result of allTasks) {
        for (const task of result.tasks) {
            const normalizedTitle = normalizeTaskName(task.title);
            if (normalizedTitle.startsWith(normalizedSearch)) {
                return task;
            }
        }
    }
    
    // Partial match
    for (const result of allTasks) {
        for (const task of result.tasks) {
            if (normalizeTaskName(task.title).includes(normalizedSearch)) {
                return task;
            }
        }
    }
    
    return null;
}

/**
 * Normalize a string for task matching: lowercase and replace any sequence of non-alphanumeric chars with single dash
 */
function normalizeTaskName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export default function (pi: ExtensionAPI) {
    // Batch mode state for /task-work all
    let batchMode = false;
    let batchTasks: TaskInfo[] = [];
    let batchIndex = 0;

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
        description: "Manage tasks. Actions: list (show all), create (new task), move (change folder), append (add content), delete, rename, search (find by name), submit-qa (submit active task to QA)",
        promptSnippet: "Manage project tasks via task tools",
        promptGuidelines: ["Use task tools when asked to work with tasks, list tasks, or assign work"],
        parameters: TasksParamsSchema as any,

        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const p = params as TasksParams;
            const workspace = getWorkspaceName(ctx.cwd);
            try {
                switch (p.action) {
                    case "create": {
                        if (!p.title) {
                            return {
                                content: [{ type: "text", text: "Error: title required for create" }],
                                details: { error: "missing parameters" }
                            };
                        }
                        const priority = p.priority || "medium";
                        const id = await runScript("create-task", workspace, { Title: p.title, Priority: priority });
                        return {
                            content: [{ type: "text", text: `Created task "${p.title}" [${priority}] (${id.substring(0, 8)})` }],
                            details: { action: "create", id, title: p.title, priority, workspace }
                        };
                    }

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

                    case "submit-qa": {
                        const activeTasks = await listTasks(workspace, "Active");
                        if (activeTasks.length === 0) {
                            return {
                                content: [{ type: "text", text: "No active task to submit to QA" }],
                                details: { error: "no active task" }
                            };
                        }
                        if (activeTasks.length > 1) {
                            return {
                                content: [{ type: "text", text: "Multiple active tasks. Please specify which task to submit." }],
                                details: { error: "multiple active tasks" }
                            };
                        }
                        const taskName = activeTasks[0].title;
                        const result = await runScript("submit-to-qa", workspace, { Name: taskName, Context: p.message || "" });
                        return {
                            content: [{ type: "text", text: `Submitted "${taskName}" to QA: ${p.message || ""}` }],
                            details: { action: "submit-qa", task: taskName, result }
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
                const openTasks = await getOpenTasks(workspace);
                let output = "Tasks:\n";
                for (const result of openTasks) {
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
            const openTasks = await getOpenTasks(workspace);
            const items: { value: string; label: string }[] = [];
            
            for (const result of openTasks) {
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
            const exactMatch = await findExactMatch(workspace, args);
            
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

    // Helper to find task file path and open it in default editor
    async function findTaskPath(workspace: string, name: string): Promise<string | null> {
        const normalizedName = normalizeTaskName(name);
        
        for (const folder of ["Backlog", "Active", "user-qa", "Closed"]) {
            const folderPath = resolve(TASKS_ROOT, workspace, folder);
            const { readdir } = await import("node:fs/promises");
            
            let files: string[];
            try {
                files = await readdir(folderPath);
            } catch {
                continue;
            }
            
            for (const file of files) {
                if (!file.endsWith(".md")) continue;
                const fileNameLower = file.toLowerCase();
                if (fileNameLower.startsWith(normalizedName) || fileNameLower.includes(normalizedName)) {
                    return resolve(folderPath, file);
                }
            }
        }
        return null;
    }

    async function openTaskFileInEditor(filePath: string, title: string, ctx: any) {
        try {
            const isWindows = process.platform === "win32";
            const cmd = isWindows ? `start "" "${filePath}"` : `open "${filePath}"`;
            await execAsync(cmd);
            ctx.ui.notify(`Opened "${title}" in editor`, "info");
        } catch (error) {
            ctx.ui.notify(`Error opening task: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
    }

    // Register /task-open command - open a task in the default editor
    pi.registerCommand("task-open", {
        description: "Open a task file in the default editor (use /task-open <name>)",
        async handler(args, ctx) {
            const workspace = getWorkspaceName(ctx.cwd);
            
            if (!args) {
                // No args provided - show picker with all tasks
                const allTasks = await getAllTasks(workspace);
                const items: { value: string; label: string }[] = [];
                
                for (const result of allTasks) {
                    for (const task of result.tasks) {
                        items.push({
                            value: task.title,
                            label: `[${result.folder}] ${task.title}`
                        });
                    }
                }
                
                if (items.length === 0) {
                    ctx.ui.notify("No tasks found", "info");
                    return;
                }
                
                const choice = await ctx.ui.select("Select a task to open:", items.map(i => i.label));
                if (!choice) {
                    ctx.ui.notify("Cancelled", "info");
                    return;
                }
                
                const selected = items.find((_, i) => items[i].label === choice);
                if (selected) {
                    const filePath = await findTaskPath(workspace, selected.value);
                    if (filePath) {
                        await openTaskFileInEditor(filePath, selected.value, ctx);
                    } else {
                        ctx.ui.notify(`Could not find task file for "${selected.value}"`, "error");
                    }
                }
                return;
            }
            
            // Find tasks matching the input
            const matches = await findAllMatching(workspace, args);
            const exactMatch = await findExactMatch(workspace, args);
            
            if (exactMatch) {
                // Exact match found - open directly
                const filePath = await findTaskPath(workspace, exactMatch.title);
                if (filePath) {
                    await openTaskFileInEditor(filePath, exactMatch.title, ctx);
                } else {
                    ctx.ui.notify(`Could not find task file for "${exactMatch.title}"`, "error");
                }
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
                const filePath = await findTaskPath(workspace, selected.value);
                if (filePath) {
                    await openTaskFileInEditor(filePath, selected.value, ctx);
                } else {
                    ctx.ui.notify(`Could not find task file for "${selected.value}"`, "error");
                }
            }
        },
    });

    // Register /task-create command - create a new task (alias for /task-new)
    pi.registerCommand("task-create", {
        description: "Create a new task (use /task-create [-o] <title> [--priority=high])",
        async handler(args, ctx) {
            const workspace = getWorkspaceName(ctx.cwd);
            if (!args) {
                ctx.ui.notify("Usage: /task-create [-o] <title> [--priority=low|medium|high|critical]", "info");
                return;
            }

            // Parse -o flag (must be at start, standalone)
            let openTask = false;
            let remaining = args;
            if (args.match(/^-o\s/)) {
                openTask = true;
                remaining = args.replace(/^-o\s/, "");
            }

            // Parse priority from args if present
            let title = remaining;
            let priority = "medium";
            const priorityMatch = remaining.match(/--priority=(\w+)/);
            if (priorityMatch) {
                priority = priorityMatch[1];
                title = remaining.replace(/--priority=\w+\s*/, "");
            }

            const id = await runScript("create-task", workspace, { Title: title, Priority: priority });
            ctx.ui.notify(`Created task "${title}" (${id.substring(0, 8)})`, "info");

            // Open task after creation if -o flag was set
            if (openTask) {
                const filePath = await findTaskPath(workspace, title);
                if (filePath) {
                    await openTaskFileInEditor(filePath, title, ctx);
                } else {
                    ctx.ui.notify(`Could not find task file for "${title}"`, "error");
                }
            }
        },
    });

    // Register /task-new command - create a new task (kept for backward compatibility)
    pi.registerCommand("task-new", {
        description: "Create a new task (use /task-new [-o] <title> [--priority=high]) - Alias: /task-create",
        async handler(args, ctx) {
            const workspace = getWorkspaceName(ctx.cwd);
            if (!args) {
                ctx.ui.notify("Usage: /task-new [-o] <title> [--priority=low|medium|high|critical]", "info");
                return;
            }

            // Parse -o flag (must be at start, standalone)
            let openTask = false;
            let remaining = args;
            if (args.match(/^-o\s/)) {
                openTask = true;
                remaining = args.replace(/^-o\s/, "");
            }

            // Parse priority from args if present
            let title = remaining;
            let priority = "medium";
            const priorityMatch = remaining.match(/--priority=(\w+)/);
            if (priorityMatch) {
                priority = priorityMatch[1];
                title = remaining.replace(/--priority=\w+\s*/, "");
            }

            const id = await runScript("create-task", workspace, { Title: title, Priority: priority });
            ctx.ui.notify(`Created task "${title}" (${id.substring(0, 8)})`, "info");

            // Open task after creation if -o flag was set
            if (openTask) {
                const filePath = await findTaskPath(workspace, title);
                if (filePath) {
                    await openTaskFileInEditor(filePath, title, ctx);
                } else {
                    ctx.ui.notify(`Could not find task file for "${title}"`, "error");
                }
            }
        },
    });


    // Register /task-work command - assign task and instruct agent to work on it
    pi.registerCommand("task-work", {
        description: "Assign a task to Active and instruct agent to work on it (use /task-work <name> or /task-work all)",
        async handler(args, ctx) {
            const workspace = getWorkspaceName(ctx.cwd);
            
            // Check for "all" argument
            if (args === "all") {
                const backlogTasks = await listTasks(workspace, "Backlog");
                
                if (backlogTasks.length === 0) {
                    ctx.ui.notify("No tasks in Backlog", "info");
                    return;
                }
                
                const confirmed = await ctx.ui.confirm(
                    "Batch Mode",
                    `Work on ${backlogTasks.length} task(s) from Backlog?`
                );
                
                if (!confirmed) {
                    ctx.ui.notify("Cancelled", "info");
                    return;
                }
                
                // Set batch state and start processing
                batchMode = true;
                batchTasks = backlogTasks;
                batchIndex = 0;
                
                await processNextBatchTask(workspace, ctx);
                return;
            }
            
            // If no args, check active tasks or show all tasks
            if (!args) {
                const activeTasks = await listTasks(workspace, "Active");
                if (activeTasks.length === 0) {
                    // No active task - show all tasks like /task-complete does
                    const openTasks = await getOpenTasks(workspace);
                    const items: { value: string; label: string }[] = [];
                    
                    for (const result of openTasks) {
                        for (const task of result.tasks) {
                            items.push({
                                value: task.title,
                                label: `[${result.folder}] ${task.title}`
                            });
                        }
                    }
                    
                    if (items.length === 0) {
                        ctx.ui.notify("No tasks found", "info");
                        return;
                    }
                    
                    const choice = await ctx.ui.select("Select a task to work on:", items.map(i => i.label));
                    if (!choice) {
                        ctx.ui.notify("Cancelled", "info");
                        return;
                    }
                    
                    const selected = items.find((_, i) => items[i].label === choice);
                    if (selected) {
                        await assignTaskToAgent(workspace, selected.value, ctx);
                    }
                    return;
                }
                if (activeTasks.length === 1) {
                    // Use the single active task
                    await assignTaskToAgent(workspace, activeTasks[0].title, ctx);
                    return;
                }
                ctx.ui.notify(`Multiple active tasks. Use /task-work <task-name>`, "info");
                return;
            }

            const matches = await findAllMatching(workspace, args);
            const exactMatch = await findExactMatch(workspace, args);
            
            if (exactMatch) {
                await assignTaskToAgent(workspace, exactMatch.title, ctx);
                return;
            }
            
            if (matches.length === 0) {
                ctx.ui.notify(`No task found matching "${args}"`, "error");
                return;
            }
            
            const items: { value: string; label: string }[] = matches.map(task => ({
                value: task.title,
                label: `[${task.folder}] ${task.title}`
            }));

            const choice = await ctx.ui.select(`${matches.length} tasks matching "${args}":`, items.map(i => i.label));
            if (!choice) {
                ctx.ui.notify("Cancelled", "info");
                return;
            }

            const selected = items.find((_, i) => items[i].label === choice);
            if (selected) {
                await assignTaskToAgent(workspace, selected.value, ctx);
            }
        }
    });

    // Process next task in batch mode
    async function processNextBatchTask(workspace: string, ctx: any) {
        if (batchIndex >= batchTasks.length) {
            // Batch complete
            const count = batchTasks.length;
            batchMode = false;
            batchTasks = [];
            batchIndex = 0;
            ctx.ui.notify(`Batch complete: ${count} tasks processed`, "info");
            return;
        }
        
        const currentTask = batchTasks[batchIndex];
        
        // Move any existing Active to Backlog
        const activeTasks = await listTasks(workspace, "Active");
        if (activeTasks.length > 0) {
            await runScript("move-task", workspace, { Name: activeTasks[0].title, NewFolder: "Backlog" });
        }
        
        // Move current batch task to Active
        await runScript("move-task", workspace, { Name: currentTask.title, NewFolder: "Active" });
        
        // Get task content
        const content = await getTaskContent(workspace, currentTask.title);
        if (content) {
            const taskNum = batchIndex + 1;
            const totalTasks = batchTasks.length;
            
            const messageContent = `Continuing Batch: Task ${taskNum} of ${totalTasks}

Work on the following task:

${content}

---

**Instructions:**
1. Read and understand the task above
2. Implement the changes
3. Commit your changes with a meaningful message
4. Use \`/submit-qa <brief description of changes>\` to submit to QA
5. This message IS the continuation signal - after submitting to QA, the next task will arrive automatically. Do NOT wait for any other input.

---`;
            
            // Use sendMessage with triggerTurn to force a new agent turn
            pi.sendMessage({
                customType: "batch-continue",
                content: messageContent,
                display: true,
            }, {
                triggerTurn: true,
            });
        }
        
        ctx.ui.notify(`Now working on: "${currentTask.title}" (${batchIndex + 1}/${batchTasks.length})`, "info");
    }

    // Helper to assign task and send to agent
    async function assignTaskToAgent(workspace: string, title: string, ctx: any) {
        const activeTasks = await listTasks(workspace, "Active");
        if (activeTasks.length > 0) {
            await runScript("move-task", workspace, { Name: activeTasks[0].title, NewFolder: "Backlog" });
        }
        await runScript("move-task", workspace, { Name: title, NewFolder: "Active" });
        
        const content = await getTaskContent(workspace, title);
        if (content) {
            // Send task content with triggerTurn to start the agent
            const steerContent = `Work on the following task:

${content}

---

## Workflow
1. Read and understand the task above
2. Implement the changes
3. Commit your changes with a meaningful message
4. Use \`/submit-qa <brief description of changes>\` to submit to QA

---`;
            pi.sendMessage({
                customType: "task-work",
                content: steerContent,
                display: true,
            }, {
                triggerTurn: true,
            });
        }
        
        ctx.ui.notify(`Now working on: "${title}"`, "info");
    }

    // Register /submit-qa command - submit active task to QA (handles batch mode)
    pi.registerCommand("submit-qa", {
        description: "Submit active task to QA (use /submit-qa <message>)",
        async handler(args, ctx) {
            const workspace = getWorkspaceName(ctx.cwd);
            
            const activeTasks = await listTasks(workspace, "Active");
            if (activeTasks.length === 0) {
                ctx.ui.notify("No active task to submit to QA", "error");
                return;
            }
            
            const taskName = activeTasks[0].title;
            
            // Move to user-qa folder
            await runScript("move-task", workspace, { Name: taskName, NewFolder: "user-qa" });
            
            // Append QA submission note
            const qaNote = args
                ? `\n## QA Submission\n${args}\n`
                : `\n## QA Submission\nSubmitted to QA.\n`;
            await runScript("append-task", workspace, { Name: taskName, Content: qaNote });
            
            ctx.ui.notify(`Submitted "${taskName}" to QA`, "info");
            
            // If in batch mode, process next task
            if (batchMode) {
                batchIndex++;
                await processNextBatchTask(workspace, ctx);
            }
        }
    });

    // Register /task-complete command - mark task as completed
    pi.registerCommand("task-complete", {
        description: "Mark a task as complete (use /task-complete <name>)",
        async handler(args, ctx) {
            const workspace = getWorkspaceName(ctx.cwd);
            
            // If no args, list all non-closed tasks for selection
            if (!args) {
                const openTasks = await getOpenTasks(workspace);
                const items: { value: string; label: string }[] = [];
                
                for (const result of openTasks) {
                    for (const task of result.tasks) {
                        items.push({
                            value: task.title,
                            label: `[${result.folder}] ${task.title}`
                        });
                    }
                }
                
                if (items.length === 0) {
                    ctx.ui.notify("No tasks found", "info");
                    return;
                }
                
                const choice = await ctx.ui.select("Select a task to complete:", items.map(i => i.label));
                if (!choice) {
                    ctx.ui.notify("Cancelled", "info");
                    return;
                }
                
                const selected = items.find((_, i) => items[i].label === choice);
                if (selected) {
                    args = selected.value;
                }
            }

            // Find tasks matching the input
            const matches = await findAllMatching(workspace, args);
            
            // Check for exact match
            const exactMatch = await findExactMatch(workspace, args);
            
            if (exactMatch) {
                // Exact match found - process directly
                const title = exactMatch.title;
                
                // Move to Closed folder (with AllowClosed flag)
                await runScript("move-task", workspace, { Name: title, NewFolder: "Closed", AllowClosed: true });
                
                // Append completion note
                const qaNote = `\n## Completed\nTask marked as complete.`;
                await runScript("append-task", workspace, { Name: title, Content: qaNote });
                
                ctx.ui.notify(`Moved "${title}" to Closed`, "info");
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
                
                // Move to Closed folder (with AllowClosed flag)
                await runScript("move-task", workspace, { Name: title, NewFolder: "Closed", AllowClosed: true });
                
                // Append completion note
                const qaNote = `\n## Completed\nTask marked as complete.`;
                await runScript("append-task", workspace, { Name: title, Content: qaNote });
                
                ctx.ui.notify(`Moved "${title}" to Closed`, "info");
            }
        },
    });
}