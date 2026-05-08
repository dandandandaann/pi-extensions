declare module "@mariozechner/pi-coding-agent" {
  export interface ExtensionAPI {
    on(event: string, handler: Function): void;
    setModel(model: any): Promise<boolean>;
    setThinkingLevel(level: string): void;
    registerCommand(name: string, options: any): void;
    registerShortcut(keys: string, config: any): void;
    registerTool(toolDefinition: any): void;
  }
  
  export interface ExtensionContext {
    modelRegistry: {
      find(provider: string, model: string): any;
      hasConfiguredAuth(model: any): boolean;
      models: any[];
    };
    model: any;
    ui: {
      notify(message: string, type?: string): void;
      select(title: string, items: string[]): Promise<string | null>;
      custom<T>(component: (tui: any, theme: any, kb: any, done: (value: T) => void) => { render: (w: any) => string[]; invalidate: () => void; handleInput: (data: any) => void }): Promise<T | null>;
      setStatus(id: string, value: string | undefined): void;
    };
    api: any;
  }
  
  export interface ExtensionCommandContext extends ExtensionContext {
    waitForIdle(): Promise<void>;
    newSession(options?: {
      parentSession?: string;
      setup?: (sessionManager: any) => Promise<void> | void;
      withSession?: (ctx: any) => Promise<void>;
    }): Promise<{ cancelled: boolean }>;
    fork(entryId: string, options?: {
      position?: "before" | "at";
      withSession?: (ctx: any) => Promise<void>;
    }): Promise<{ cancelled: boolean }>;
    navigateTree(targetId: string, options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    }): Promise<{ cancelled: boolean }>;
    switchSession(sessionPath: string, options?: {
      withSession?: (ctx: any) => Promise<void>;
    }): Promise<{ cancelled: boolean }>;
    reload(): Promise<void>;
  }
  
  export interface ToolCallEvent {
    toolName: string;
  }
  
  export interface BeforeAgentStartEvent {
    systemPrompt: string;
  }
  
  export interface BeforeProviderRequestEvent {}
  
  export interface AgentStartEvent {}
  
  export type Input = any;
}

declare module "@mariozechner/pi-tui" {
  export class Input {
    focused: boolean;
    onSubmit?: (text: string) => void;
    render(w: any): string[];
    invalidate(): void;
    handleInput(data: any): void;
  }
}