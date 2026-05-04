declare module '@mariozechner/pi-coding-agent' {
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
      setStatus(id: string, value: string | undefined): void;
    };
    api: any;
  }
  
  export interface ToolCallEvent {
    toolName: string;
  }
  
  export interface BeforeAgentStartEvent {
    systemPrompt: string;
  }
  
  export interface BeforeProviderRequestEvent {}
  
  export interface AgentStartEvent {}
}
