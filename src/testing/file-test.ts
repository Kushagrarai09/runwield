/** Preserve Deno's filesystem-only test permission scope during the Bun migration. */
import { test } from "node:test";
import { versions } from "node:process";

interface FilesystemTestDefinition {
    name: string;
    permissions: { read: true; write: true };
    fn: () => void | Promise<void>;
}
interface PermissionTestRuntime {
    test(definition: FilesystemTestDefinition): void;
}

export function testWithFsPermissions(name: string, fn: () => void | Promise<void>): void {
    if (versions.deno) {
        const runtime: PermissionTestRuntime = Reflect.get(globalThis, "Deno");
        runtime.test({ name, permissions: { read: true, write: true }, fn });
    } else {
        // Bun has no per-test permission API; the isolated runner supplies the
        // disposable HOME/database/filesystem boundary for this identical case.
        test(name, fn);
    }
}
