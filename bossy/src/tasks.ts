/**
 * Tasks module - reconstructs todo state from session.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Todo, TodoSnapshot } from "./types";

/**
 * Walk session branch and find the last todo tool result.
 * Returns a snapshot of todos at that point.
 */
export function getTodoSnapshot(ctx: ExtensionContext): TodoSnapshot {
  const todos: Todo[] = [];
  const branch = ctx.sessionManager.getBranch();
  for (const entry of branch) {
    if (
      entry.type === "message" &&
      entry.message.role === "toolResult" &&
      entry.message.toolName === "todo"
    ) {
      const parsed = entry.message.details.todos as Todo[] | undefined;
      if (parsed) {
        todos.length = 0;
        todos.push(...parsed);
      }
    }
  }
  const open: TodoSnapshot["open"] = todos
    .filter((t) => !t.done)
    .map(({ id, text }) => ({ id, text, done: false as const }));
  return { open, allDone: open.length === 0 };
}

/** Returns all open tasks with id + text only */
export function getOpenTasks(
  ctx: ExtensionContext
): Array<{ id: number; text: string }> {
  return getTodoSnapshot(ctx).open.map(({ id, text }) => ({ id, text }));
}

/** Returns the open task with the smallest id, or null if none */
export function getOldestOpenTask(
  ctx: ExtensionContext
): { id: number; text: string } | null {
  const open = getOpenTasks(ctx);
  if (open.length === 0) return null;
  return open.reduce((oldest, current) =>
    current.id < oldest.id ? current : oldest
  );
}

/** Whether there are any open tasks */
export function hasOpenTasks(ctx: ExtensionContext): boolean {
  return getOpenTasks(ctx).length > 0;
}
