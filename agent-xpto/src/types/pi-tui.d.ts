declare module "@mariozechner/pi-tui" {
  export class Input {
    focused: boolean;
    onSubmit?: (text: string) => void;
    render(w: any): string[];
    invalidate(): void;
    handleInput(data: any): void;
  }
}