/**
 * Mock ExtensionAPI for unit testing.
 */

export interface MockExtensionAPI {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  registerCommand: (name: string, config: { description: string; getArgumentCompletions?: (prefix: string) => { value: string; label: string }[]; handler: (args: string | undefined, ctx: { ui: { notify: (msg: string, type: string) => void } }) => void }) => void;
  handlers: Map<string, Set<(...args: unknown[]) => void>>;
  commands: Map<string, { description: string; handler: (...args: unknown[]) => void }>;
}

/**
 * Create a mock ExtensionAPI instance.
 */
export function createMockExtensionAPI(): MockExtensionAPI {
  return {
    on: function(event: string, handler: (...args: unknown[]) => void): void {
      if (!this.handlers.has(event)) {
        this.handlers.set(event, new Set());
      }
      this.handlers.get(event)!.add(handler);
    },
    registerCommand: function(name: string, config: { description: string; getArgumentCompletions?: (prefix: string) => { value: string; label: string }[]; handler: (args: string | undefined, ctx: { ui: { notify: (msg: string, type: string) => void } }) => void }): void {
      this.commands.set(name, { description: config.description, handler: config.handler });
    },
    handlers: new Map(),
    commands: new Map(),
  };
}

/**
 * Trigger an event on the mock ExtensionAPI.
 */
export function triggerEvent(api: MockExtensionAPI, event: string, ...args: unknown[]): void {
  const handlers = api.handlers.get(event);
  if (handlers) {
    for (const handler of handlers) {
      handler(...args);
    }
  }
}