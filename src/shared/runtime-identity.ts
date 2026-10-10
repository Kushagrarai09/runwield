/** Identify a compiled runtime without treating a generated build-id file as proof. */
import { versions } from "node:process";

interface DenoBuildRuntime {
    build: { standalone: boolean };
}
export function isStandaloneExecutable(): boolean {
    if (versions.deno) {
        const runtime: DenoBuildRuntime = Reflect.get(globalThis, "Deno");
        return runtime.build.standalone;
    }
    // Bun compiled modules live in its embedded filesystem. Source execution
    // cannot obtain this URL merely by placing a build identity next to source.
    return Boolean(versions.bun && new URL(import.meta.url).pathname.startsWith("/$bunfs/"));
}
