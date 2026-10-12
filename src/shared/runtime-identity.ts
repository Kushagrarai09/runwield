/** Identify a compiled runtime without treating a generated build-id file as proof. */
import { versions } from "node:process";

interface DenoBuildRuntime {
    build: { standalone: boolean };
}
export function isStandaloneExecutable(): boolean {
    if (versions.deno) {
        const runtime: DenoBuildRuntime = Reflect.get(globalThis, String("Deno"));
        return runtime.build.standalone;
    }
    if (!versions.bun) return false;
    // Bun exposes this directly on every supported target, including Windows.
    // Embedded filesystem path spellings differ by platform.
    const runtime: { isStandaloneExecutable: boolean } = Reflect.get(globalThis, String("Bun"));
    return runtime.isStandaloneExecutable;
}
