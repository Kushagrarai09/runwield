/** The native PTY boundary used by the real interactive installer fixtures. */
export interface FixtureTerminal {
    write(input: string): number;
    close(): void;
}
interface TerminalOptions {
    cols: number;
    rows: number;
    data(terminal: FixtureTerminal, data: Uint8Array): void;
}
interface TerminalProcessOptions {
    cwd: string;
    timeout: number;
    terminal: TerminalOptions;
}
interface TerminalProcess {
    terminal: FixtureTerminal;
    exited: Promise<number>;
}
export interface TerminalRuntime {
    spawn(command: string[], options: TerminalProcessOptions): TerminalProcess;
}
