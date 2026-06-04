/**
 * Task Manager Extension for Pi
 * 
 * Manages tasks via Markdown files with native Node.js file operations.
 * Cross-platform: works on Windows, macOS, and Linux.
 * - Blocks direct access to ~/.pi/tasks/ folder
 * - Provides CRUD tools and commands for task management
 * - Enforces single-active task policy with user confirmation
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import { resolve, join, basename } from "node:path";
import { readdir, readFile, writeFile, appendFile, mkdir, rename, unlink, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Text } from "@mariozechner/pi-tui";

const VERSION = "0.2.0";
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
    filename: string;
    title: string;
    priority: string;
    created: string;
    uuid: string;
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
    file: Type.Optional(Type.String({ description: "File path to read content from (for append action)" })),
    newTitle: Type.Optional(Type.String({ description: "New title (for rename action)" })),
    title: Type.Optional(Type.String({ description: "Task title (for create action)" })),
    priority: Type.Optional(Type.Union([
        Type.Literal("low"),
        Type.Literal("medium"),
        Type.Literal("high"),
        Type.Literal("critical")
    ], { description: "Task priority (for create action), defaults to medium" })),
    message: Type.Optional(Type.String({ description: "QA submission message (for submit-qa action)" })),
    uuid: Type.Optional(Type.String({ description: "Task UUID (for move, rename, delete, append, get, submit-qa)" })),
    id: Type.Optional(Type.String({ description: "Task ID (same as uuid)" })),
});
type TasksParams = Static<typeof TasksParamsSchema>;



const FOLDERS = ["Backlog", "Active", "user-qa", "Closed"] as const;

/**
 * Ensure a directory exists, creating it recursively if needed
 */
async function ensureDir(dirPath: string): Promise<void> {
    await mkdir(dirPath, { recursive: true });
}

/**
 * Parse YAML frontmatter from a markdown file's content.
 * Returns an object with id, title, priority, created fields.
 */
function parseFrontmatter(content: string): { id: string; title: string; priority: string; created: string } {
    const result = { id: "", title: "Untitled", priority: "medium", created: "" };
    // Remove UTF-8 BOM if present (some older files have it)
    const cleanContent = content.replace(/^\uFEFF/, '');
    const match = cleanContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return result;
    const fm = match[1];
    const titleMatch = fm.match(/title:\s*(.+)/);
    if (titleMatch) result.title = titleMatch[1].trim();
    const priorityMatch = fm.match(/priority:\s*(.+)/);
    if (priorityMatch) result.priority = priorityMatch[1].trim();
    const createdMatch = fm.match(/created:\s*(.+)/);
    if (createdMatch) result.created = createdMatch[1].trim();
    const idMatch = fm.match(/id:\s*(.+)/);
    if (idMatch) result.id = idMatch[1].trim();
    return result;
}

/**
 * Find a task file by UUID across all folders.
 * Returns the full file path and the folder it was found in, or null.
 */
async function findTaskFileByUUID(workspace: string, uuid: string): Promise<{ filePath: string; folder: string } | null> {
    for (const folder of FOLDERS) {
        const dir = resolve(TASKS_ROOT, workspace, folder);
        let files: string[];
        try {
            files = await readdir(dir);
        } catch {
            continue;
        }
        for (const file of files) {
            if (!file.endsWith(".md")) continue;
            const filePath = resolve(dir, file);
            try {
                const content = await readFile(filePath, "utf8");
                const fm = parseFrontmatter(content);
                if (fm.id === uuid || fm.id.startsWith(uuid)) {
                    return { filePath, folder };
                }
            } catch {
                continue;
            }
        }
    }
    return null;
}

/**
 * List all tasks in a given folder for a workspace (native fs implementation)
 */
async function listTasks(workspace: string, folder: string): Promise<TaskInfo[]> {
    const dir = resolve(TASKS_ROOT, workspace, folder);
    let files: string[];
    try {
        files = await readdir(dir);
    } catch {
        return [];
    }

    const tasks: TaskInfo[] = [];
    for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const filePath = resolve(dir, file);
        try {
            const content = await readFile(filePath, "utf8");
            const fm = parseFrontmatter(content);
            const baseName = file.replace(/\.md$/, "");
            tasks.push({
                filename: baseName,
                title: fm.title,
                priority: fm.priority,
                created: fm.created,
                uuid: fm.id,
                folder,
            });
        } catch {
            continue;
        }
    }
    return tasks;
}

/**
 * Get all tasks across folders for a workspace
 */
async function getAllTasks(workspace: string): Promise<ListResult[]> {
    return Promise.all(FOLDERS.map(async folder => ({
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
async function findAllMatchingTasks(workspace: string, name: string): Promise<TaskInfo[]> {
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
async function findExactMatchTask(workspace: string, name: string): Promise<TaskInfo | null> {
    const matches = await findAllMatchingTasks(workspace, name);
    const normalizedSearch = normalizeTaskName(name);
    return matches.find(m => normalizeTaskName(m.title) === normalizedSearch) || null;
}

/**
 * Get full task file content by scanning the directory
 */
async function getTaskContent(workspace: string, name: string): Promise<string | null> {
    for (const folder of FOLDERS) {
        const folderPath = resolve(TASKS_ROOT, workspace, folder);
        let files: string[];
        try {
            files = await readdir(folderPath);
        } catch {
            continue;
        }

        const normalizedName = normalizeTaskName(name);
        for (const file of files) {
            if (!file.endsWith(".md")) continue;
            const fileNameLower = file.toLowerCase();
            if (fileNameLower.startsWith(normalizedName) || fileNameLower.includes(normalizedName)) {
                const filePath = resolve(folderPath, file);
                try {
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
 * Create a new task file. Returns the generated UUID.
 */
async function createTask(workspace: string, title: string, priority: string = "medium", content?: string): Promise<string> {
    const folderPath = resolve(TASKS_ROOT, workspace, "Backlog");
    await ensureDir(folderPath);

    const id = randomUUID();
    const created = new Date().toISOString().slice(0, 10);
    const safeName = title.replace(/[^\w\-]/g, "-").replace(/-+/g, "-");
    let fileName = `${safeName}.md`;
    let filePath = resolve(folderPath, fileName);

    // Handle name collisions
    let i = 1;
    try {
        while (await stat(filePath)) {
            fileName = `${safeName}-${i}.md`;
            filePath = resolve(folderPath, fileName);
            i++;
        }
    } catch {
        // File doesn't exist, which is what we want
    }

    const body = content ? `${content}\n\n` : "";
    const fileContent = `---\nid: ${id}\ntitle: ${title}\ncreated: ${created}\npriority: ${priority}\ntags:\n---\n\n# ${title}\n\n${body}`;
    await writeFile(filePath, fileContent, "utf8");
    return id;
}

/**
 * Move a task to a different folder by UUID.
 * Returns "oldFolder\tnewFolder".
 */
async function moveTask(workspace: string, uuid: string, newFolder: string, allowClosed: boolean = false): Promise<string> {
    if (newFolder === "Closed" && !allowClosed) {
        throw new Error("Use submit-qa to move the task to user-qa instead of directly moving it to Closed.");
    }

    const found = await findTaskFileByUUID(workspace, uuid);
    if (!found) {
        throw new Error(`Task with UUID '${uuid}' not found`);
    }

    const newDir = resolve(TASKS_ROOT, workspace, newFolder);
    await ensureDir(newDir);

    const fileName = basename(found.filePath);
    const newPath = resolve(newDir, fileName);
    await rename(found.filePath, newPath);
    return `${found.folder}\t${newFolder}`;
}

/**
 * Append content to a task by UUID.
 */
async function appendToTask(workspace: string, uuid: string, content?: string, fileSrc?: string): Promise<string> {
    const found = await findTaskFileByUUID(workspace, uuid);
    if (!found) {
        throw new Error(`Task with UUID '${uuid}' not found`);
    }

    let appendContent = content;
    if (fileSrc) {
        appendContent = await readFile(fileSrc, "utf8");
    }

    if (!appendContent) {
        throw new Error("Either content or file parameter is required");
    }

    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);
    const toAppend = `\n----\n${timestamp}\n${appendContent}`;
    await appendFile(found.filePath, toAppend, "utf8");

    return await readFile(found.filePath, "utf8");
}

/**
 * Delete a task by UUID. Returns the folder it was in.
 */
async function deleteTask(workspace: string, uuid: string): Promise<string> {
    const found = await findTaskFileByUUID(workspace, uuid);
    if (!found) {
        throw new Error(`Task with UUID '${uuid}' not found`);
    }
    await unlink(found.filePath);
    return found.folder;
}

/**
 * Rename a task by UUID. Updates the title in frontmatter. Returns the folder.
 */
async function renameTaskFile(workspace: string, uuid: string, newTitle: string): Promise<string> {
    const found = await findTaskFileByUUID(workspace, uuid);
    if (!found) {
        throw new Error(`Task with UUID '${uuid}' not found`);
    }

    let content = await readFile(found.filePath, "utf8");
    content = content.replace(/^(title:).+/m, `$1 ${newTitle}`);
    await writeFile(found.filePath, content, "utf8");
    return found.folder;
}

/**
 * Submit a task to QA: append a QA note and move to user-qa folder.
 */
async function submitTaskToQa(workspace: string, uuid: string, context: string): Promise<string> {
    const found = await findTaskFileByUUID(workspace, uuid);
    if (!found) {
        throw new Error(`Task with UUID '${uuid}' not found`);
    }

    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);
    const qaNote = `\n----\n${timestamp}\n## Submitted to QA\n${context}`;
    await appendFile(found.filePath, qaNote, "utf8");

    const newDir = resolve(TASKS_ROOT, workspace, "user-qa");
    await ensureDir(newDir);
    const fileName = basename(found.filePath);
    const newPath = resolve(newDir, fileName);
    await rename(found.filePath, newPath);
    return "Moved to user-qa";
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
    return name.toLowerCase().replace(/[^a-z0-9_]+/g, "-").replace(/^-+|-+$/g, "");
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
        description: "Manage tasks. Tasks are NOT accessible as files - always use this tool. Actions: list: Show all tasks grouped by folder. create: Create new task (requires title, optional priority). get: Get task details (requires uuid or id). append: Add content to task (requires uuid, use content= for short text OR file= for large content). move: Move task to folder (requires uuid, folder: Backlog|Active|Closed). rename: Rename task (requires uuid, newTitle). delete: Delete task (requires uuid). search: Find task by name (requires name). submit-qa: Submit active task to QA (optional message)",
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
                        const id = await createTask(workspace, p.title, priority, p.content);
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
                                    output += `- **${task.title}** [${task.priority}] ${task.uuid.substring(0, 8)}\n`;
                                }
                            }
                        }
                        return {
                            content: [{ type: "text", text: output || "No tasks found" }],
                            details: { action: "list", tasks: await getAllTasks(workspace) }
                        };
                    }

                    case "move": {
                        if ((!p.uuid && !p.id) || !p.folder) {
                            return {
                                content: [{ type: "text", text: "Error: uuid, id, and folder required for move" }],
                                details: { error: "missing parameters" }
                            };
                        }
                        var taskId = p.uuid || p.id;

                        // Check if moving to Active and there's already an active task
                        if (p.folder === "Active") {
                            const activeTasks = await listTasks(workspace, "Active");
                            if (activeTasks.length > 0 && activeTasks[0].uuid !== taskId) {
                                const proceed = await ctx.ui.confirm(
                                    "Active Task Exists",
                                    `Move "${activeTasks[0].title}" to Backlog and set task to Active?`
                                );
                                if (!proceed) {
                                    return {
                                        content: [{ type: "text", text: "Cancelled: keeping current active task" }],
                                        details: { action: "move", cancelled: true }
                                    };
                                }
                                // Move current active to backlog first
                                await moveTask(workspace, activeTasks[0].uuid, "Backlog");
                            }
                        }

                        const result = await moveTask(workspace, taskId!, p.folder);
                        return {
                            content: [{ type: "text", text: `Moved task to ${p.folder}` }],
                            details: { action: "move", result }
                        };
                    }

                    case "append": {
                        if ((!p.uuid && !p.id) || (!p.content && !p.file)) {
                            return {
                                content: [{ type: "text", text: "Error: uuid and content or file required for append" }],
                                details: { error: "missing parameters" }
                            };
                        }
                        var taskId = p.uuid || p.id;
                        await appendToTask(workspace, taskId!, p.content, p.file);
                        return {
                            content: [{ type: "text", text: `Added content to task` }],
                            details: { action: "append" }
                        };
                    }

                    case "delete": {
                        if (!p.uuid && !p.id) {
                            return {
                                content: [{ type: "text", text: "Error: uuid required for delete" }],
                                details: { error: "missing parameters" }
                            };
                        }
                        var taskId = p.uuid || p.id;
                        const folder = await deleteTask(workspace, taskId!);
                        return {
                            content: [{ type: "text", text: `Deleted task from ${folder}` }],
                            details: { action: "delete", folder }
                        };
                    }

                    case "rename": {
                        if ((!p.uuid && !p.id) || !p.newTitle) {
                            return {
                                content: [{ type: "text", text: "Error: uuid and newTitle required for rename" }],
                                details: { error: "missing parameters" }
                            };
                        }
                        var taskId = p.uuid || p.id;
                        const folder = await renameTaskFile(workspace, taskId!, p.newTitle!);
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
                        const taskId = p.uuid || p.id;
                        if (!taskId) {
                            return {
                                content: [{ type: "text", text: "Error: uuid required for get" }],
                                details: { error: "missing parameters" }
                            };
                        }
                        // Find task by UUID and return its content
                        const task = await getTaskByUUID(workspace, taskId);
                        if (!task) {
                            return {
                                content: [{ type: "text", text: `Task with UUID ${taskId?.substring(0, 8)} not found` }],
                                details: { action: "get", found: false }
                            };
                        }
                        const content = await getTaskContent(workspace, task.filename);
                        return {
                            content: [{ type: "text", text: content || "Could not read task content" }],
                            details: { action: "get", found: true, task }
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
                        const taskUUID = activeTasks[0].uuid;
                        const result = await submitTaskToQa(workspace, taskUUID, p.message || "");
                        return {
                            content: [{ type: "text", text: `Submitted task to QA: ${p.message || ""}` }],
                            details: { action: "submit-qa", uuid: taskUUID, result }
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
                        value: `${task.filename}`,
                        label: `[${result.folder}] ${task.title} (${task.uuid.substring(0, 8)})`
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
                const taskFilename = selected.value;
                const content = await getTaskContent(workspace, taskFilename);
                if (content) {
                    // Display the task content as a notification
                    ctx.ui.notify(`Task: ${taskFilename}\n\n${content}`, "info");
                } else {
                    ctx.ui.notify(`Could not read task "${taskFilename}"`, "error");
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
            const matches = await findAllMatchingTasks(workspace, args);
            const exactMatch = await findExactMatchTask(workspace, args);

            if (exactMatch) {
                // Exact match found - select directly
                const title = exactMatch.title;
                const taskUUID = exactMatch.uuid;

                // Auto-switch active task
                const activeTasks = await listTasks(workspace, "Active");
                if (activeTasks.length > 0 && activeTasks[0].uuid !== taskUUID) {
                    await moveTask(workspace, activeTasks[0].uuid, "Backlog");
                }
                await moveTask(workspace, taskUUID, "Active");
                ctx.ui.notify(`Now active: "${title}"`, "info");
                return;
            }

            if (matches.length === 0) {
                ctx.ui.notify(`No task found matching "${args}". Use /task-new to create one.`, "error");
                return;
            }

            // No exact match - show disambiguation list with UUIDs
            const items: { value: string; label: string }[] = [];
            for (const task of matches) {
                items.push({
                    value: task.uuid,
                    label: `[${task.folder}] ${task.title} (${task.uuid.substring(0, 8)})`
                });
            }

            const choice = await ctx.ui.select(`${matches.length} tasks matching "${args}":`, items.map(i => i.label));
            if (!choice) {
                ctx.ui.notify("Cancelled", "info");
                return;
            }

            const selected = items.find((_, i) => items[i].label === choice);
            if (selected) {
                const taskUUID = selected.value;
                const task = matches.find(m => m.uuid === taskUUID);

                // Auto-switch active task
                const activeTasks = await listTasks(workspace, "Active");
                if (activeTasks.length > 0 && activeTasks[0].uuid !== taskUUID) {
                    await moveTask(workspace, activeTasks[0].uuid, "Backlog");
                }
                await moveTask(workspace, taskUUID, "Active");
                ctx.ui.notify(`Now active: "${task?.title}"`, "info");
            }
        },
    });

    // Helper to find task file path by title or UUID
    async function findTaskPath(workspace: string, nameOrUUID: string): Promise<string | null> {
        // First try to find by UUID using shared helper
        const found = await findTaskFileByUUID(workspace, nameOrUUID);
        if (found) return found.filePath;

        // Fallback: try to find by normalized title in filename
        const normalizedName = normalizeTaskName(nameOrUUID);
        for (const folder of FOLDERS) {
            const folderPath = resolve(TASKS_ROOT, workspace, folder);
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

    // Get task info by UUID or short UUID
    async function getTaskByUUID(workspace: string, uuid: string): Promise<TaskInfo | null> {
        if (uuid.length < 8) return null; 

        const allTasks = await getAllTasks(workspace);
        for (const result of allTasks) {
            const task = result.tasks.find(t => t.uuid.startsWith(uuid));
            if (task) return task;
        }
        return null;
    }

    async function openTaskFileInEditor(filePath: string, title: string, ctx: any) {
        try {
            const platform = process.platform;
            const cmd = platform === "win32" ? `start "" "${filePath}"`
                : platform === "darwin" ? `open "${filePath}"`
                : `xdg-open "${filePath}"`;
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
                            value: task.uuid,
                            label: `[${result.folder}] ${task.title} (${task.uuid.substring(0, 8)})`
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
                    const task = await getTaskByUUID(workspace, selected.value);
                    if (task) {
                        const filePath = await findTaskPath(workspace, task.uuid);
                        if (filePath) {
                            await openTaskFileInEditor(filePath, task.title, ctx);
                        } else {
                            ctx.ui.notify(`Could not find task file for "${task.title}"`, "error");
                        }
                    } else {
                        ctx.ui.notify(`Could not find task with UUID ${selected.value.substring(0, 8)}`, "error");
                    }
                }
                return;
            }

            // Find tasks matching the input
            const matches = await findAllMatchingTasks(workspace, args);
            const exactMatch = await findExactMatchTask(workspace, args);

            if (exactMatch) {
                // Exact match found - open directly
                const filePath = await findTaskPath(workspace, exactMatch.uuid);
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

            // No exact match - show disambiguation list with UUIDs
            const items: { value: string; label: string }[] = [];
            for (const task of matches) {
                items.push({
                    value: task.uuid,
                    label: `[${task.folder}] ${task.title} (${task.uuid.substring(0, 8)})`
                });
            }

            const choice = await ctx.ui.select(`${matches.length} tasks matching "${args}":`, items.map(i => i.label));
            if (!choice) {
                ctx.ui.notify("Cancelled", "info");
                return;
            }

            const selected = items.find((_, i) => items[i].label === choice);
            if (selected) {
                const task = await getTaskByUUID(workspace, selected.value);
                if (task) {
                    const filePath = await findTaskPath(workspace, task.uuid);
                    if (filePath) {
                        await openTaskFileInEditor(filePath, task.title, ctx);
                    } else {
                        ctx.ui.notify(`Could not find task file`, "error");
                    }
                } else {
                    ctx.ui.notify(`Could not find task with UUID ${selected.value.substring(0, 8)}`, "error");
                }
            }
        },
    });

    // Register /task-create command - create a new task (alias for /task-new)
    pi.registerCommand("task-create", {
        description: "Create a new task (use /task-create [-o] <title> [--priority=high] [--content='...'])",
        async handler(args, ctx) {
            const workspace = getWorkspaceName(ctx.cwd);
            if (!args) {
                ctx.ui.notify("Usage: /task-create [-o] <title> [--priority=low|medium|high|critical] [--content='...']", "info");
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

            // Parse content from args if present
            let content = "";
            const contentMatch = title.match(/--content='([^']*)'/);
            if (contentMatch) {
                content = contentMatch[1];
                title = title.replace(/--content='[^']*'\s*/, "");
            }

            const id = await createTask(workspace, title, priority, content);
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

            const id = await createTask(workspace, title, priority);
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
            if (args === "all") { // TODO: fix command
                // const backlogTasks = await listTasks(workspace, "Backlog");

                // if (backlogTasks.length === 0) {
                //     ctx.ui.notify("No tasks in Backlog", "info");
                //     return;
                // }

                // const confirmed = await ctx.ui.confirm(
                //     "Batch Mode",
                //     `Work on ${backlogTasks.length} task(s) from Backlog?`
                // );

                // if (!confirmed) {
                //     ctx.ui.notify("Cancelled", "info");
                //     return;
                // }

                // // Set batch state and start processing
                // batchMode = true;
                // batchTasks = backlogTasks;
                // batchIndex = 0;

                // await processNextBatchTask(workspace, ctx);
                // return;
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
                                value: task.uuid,
                                label: `[${result.folder}] ${task.title} (${task.uuid.substring(0, 8)})`
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
                    await assignTaskToAgent(workspace, activeTasks[0].uuid, ctx);
                    return;
                }
                ctx.ui.notify(`Multiple active tasks. Use /task-work <task-name>`, "info");
                return;
            }

            const exactMatch = await findExactMatchTask(workspace, args);

            if (exactMatch) {
                await assignTaskToAgent(workspace, exactMatch.uuid, ctx);
                return;
            }

            const matches = await findAllMatchingTasks(workspace, args);
            if (matches.length === 0) {
                ctx.ui.notify(`No task found matching "${args}"`, "error");
                return;
            }

            const items: { value: string; label: string }[] = matches.map(task => ({
                value: task.uuid,
                label: `[${task.folder}] ${task.title} (${task.uuid.substring(0, 8)})`
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
            await moveTask(workspace, activeTasks[0].uuid, "Backlog");
        }

        // Move current batch task to Active
        await moveTask(workspace, currentTask.uuid, "Active");

        // Get task content
        const content = await getTaskContent(workspace, currentTask.filename);
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

    // Helper to assign task and send to agent (takes UUID)
    async function assignTaskToAgent(workspace: string, uuid: string, ctx: any) {
        // Find task by UUID
        const allTasks = await getAllTasks(workspace);
        let task: TaskInfo | undefined;
        for (const result of allTasks) {
            task = result.tasks.find(t => t.uuid === uuid);
            if (task) break;
        }

        if (!task) {
            ctx.ui.notify(`Task with UUID ${uuid.substring(0, 8)} not found`, "error");
            return;
        }

        const activeTasks = await listTasks(workspace, "Active");
        if (activeTasks.length > 0 && activeTasks[0].uuid !== uuid) {
            await moveTask(workspace, activeTasks[0].uuid, "Backlog");
        }
        await moveTask(workspace, uuid, "Active");

        const content = await getTaskContent(workspace, task.filename);
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

        ctx.ui.notify(`Now working on: "${task.title}"`, "info");
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

            const taskUUID = activeTasks[0].uuid;
            const taskTitle = activeTasks[0].title;

            // Move to user-qa folder
            await moveTask(workspace, taskUUID, "user-qa");

            // Append QA submission note
            const qaNote = args
                ? `\n## QA Submission\n${args}\n`
                : `\n## QA Submission\nSubmitted to QA.\n`;
            await appendToTask(workspace, taskUUID, qaNote);

            ctx.ui.notify(`Submitted "${taskTitle}" to QA`, "info");

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
                            value: task.uuid,
                            label: `[${result.folder}] ${task.title} (${task.uuid.substring(0, 8)})`
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
                    await completeTask(workspace, selected.value, ctx);
                }
                return;
            }

            // Find tasks matching the input
            const matches = await findAllMatchingTasks(workspace, args);

            // Check for exact match
            const exactMatch = await findExactMatchTask(workspace, args);

            if (exactMatch) {
                // Exact match found - process directly
                await completeTask(workspace, exactMatch.uuid, ctx);
                return;
            }

            if (matches.length === 0) {
                ctx.ui.notify(`No task found matching "${args}"`, "error");
                return;
            }

            // No exact match - show disambiguation list with UUIDs
            const items: { value: string; label: string }[] = [];
            for (const task of matches) {
                items.push({
                    value: task.uuid,
                    label: `[${task.folder}] ${task.title} (${task.uuid.substring(0, 8)})`
                });
            }

            const choice = await ctx.ui.select(`${matches.length} tasks matching "${args}":`, items.map(i => i.label));
            if (!choice) {
                ctx.ui.notify("Cancelled", "info");
                return;
            }

            const selected = items.find((_, i) => items[i].label === choice);
            if (selected) {
                await completeTask(workspace, selected.value, ctx);
            }
        },
    });

    // Helper to complete a task (takes UUID)
    async function completeTask(workspace: string, uuid: string, ctx: any) {
        // Find task by UUID
        const allTasks = await getAllTasks(workspace);
        let task: TaskInfo | undefined;
        for (const result of allTasks) {
            task = result.tasks.find(t => t.uuid === uuid);
            if (task) break;
        }

        if (!task) {
            ctx.ui.notify(`Task with UUID ${uuid.substring(0, 8)} not found`, "error");
            return;
        }

        const title = task.title;

        // Move to Closed folder (with AllowClosed flag)
        await moveTask(workspace, uuid, "Closed", true);

        // Append completion note
        const qaNote = `\n## Completed\nTask marked as complete.`;
        await appendToTask(workspace, uuid, qaNote);

        ctx.ui.notify(`Moved "${title}" to Closed`, "info");
    }
}