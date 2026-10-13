/// <reference types="astro/client" />

// Astro's checker does not load Deno's standard library declarations.
declare namespace Deno {
    function realPathSync(path: string | URL): string;
    interface WorkspaceFileInfo {
        isFile: boolean;
    }

    interface WorkspaceMkdirOptions {
        recursive?: boolean;
    }

    interface WorkspaceCommandOptions {
        cwd?: string | URL;
        args?: string[];
        stdout?: "piped" | "inherit" | "null";
        stderr?: "piped" | "inherit" | "null";
    }

    interface WorkspaceCommandOutput {
        success: boolean;
        code: number;
        stdout: Uint8Array<ArrayBuffer>;
        stderr: Uint8Array<ArrayBuffer>;
    }

    class Command {
        constructor(command: string | URL, options?: WorkspaceCommandOptions);
        output(): Promise<WorkspaceCommandOutput>;
    }

    function cwd(): string;
    function realPath(path: string | URL): Promise<string>;
    function stat(path: string | URL): Promise<WorkspaceFileInfo>;
    function statSync(path: string | URL): WorkspaceFileInfo;
    function mkdir(path: string | URL, options?: WorkspaceMkdirOptions): Promise<void>;
    function readFile(path: string | URL): Promise<Uint8Array<ArrayBuffer>>;
    function writeFile(path: string | URL, data: Uint8Array): Promise<void>;
    function readTextFile(path: string | URL): Promise<string>;

    namespace errors {
        class NotFound extends Error {}
        class NotADirectory extends Error {}
        class PermissionDenied extends Error {}
    }
}
