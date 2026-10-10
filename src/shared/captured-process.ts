/** Capture literal subprocess output without a shell or a fixed output-size ceiling. */
import { spawnForegroundProcess } from "./foreground-process.ts";

export interface CapturedProcessOptions {
    cwd: string;
    args: string[];
    env?: Record<string, string>;
}
export interface CapturedProcessOutput {
    code: number;
    stdout: Uint8Array;
    stderr: Uint8Array;
}

export async function captureForegroundProcess(
    command: string,
    options: CapturedProcessOptions,
): Promise<CapturedProcessOutput> {
    const child = spawnForegroundProcess({ command, ...options });
    try {
        const [result, stdout, stderr] = await Promise.all([
            child.done,
            new Response(child.stdout).arrayBuffer(),
            new Response(child.stderr).arrayBuffer(),
        ]);
        if (result.exitCode === null) throw new Error(`Command was terminated before producing a result: ${command}`);
        return { code: result.exitCode, stdout: new Uint8Array(stdout), stderr: new Uint8Array(stderr) };
    } catch (error) {
        child.kill();
        throw error;
    }
}
