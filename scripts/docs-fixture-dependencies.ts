/** Materialize the frozen docs dependency closure inside each real-build fixture. */
import { constants } from "node:fs";
import { cp, mkdir, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { versions } from "node:process";

export async function prepareDocsFixtureDependencies(root: string): Promise<void> {
    if (!versions.bun) return;
    const repository = fileURLToPath(new URL("../", import.meta.url));
    const store = await realpath(join(repository, "node_modules", ".bun"));
    const destination = join(root, "node_modules", ".bun");
    const visited = new Set<string>();
    await mkdir(destination, { recursive: true });
    async function visitModules(directory: string): Promise<void> {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (entry.name.startsWith(".")) continue;
            const path = join(directory, entry.name);
            if (entry.name.startsWith("@") && entry.isDirectory()) {
                await visitModules(path);
                continue;
            }
            const target = await realpath(path);
            const relativePath = relative(store, target);
            if (relativePath.startsWith("..") || resolve(store, relativePath) !== target) {
                throw new Error(`Docs dependency is outside the frozen Bun store: ${path}`);
            }
            const owner = relativePath.split("/")[0];
            if (visited.has(owner)) continue;
            visited.add(owner);
            await cp(join(store, owner), join(destination, owner), {
                recursive: true,
                verbatimSymlinks: true,
                mode: constants.COPYFILE_FICLONE,
            });
            await visitModules(join(store, owner, "node_modules"));
        }
    }
    const modules = join(repository, "docs-site", "node_modules");
    await visitModules(modules);
    await cp(modules, join(root, "docs-site", "node_modules"), {
        recursive: true,
        verbatimSymlinks: true,
        mode: constants.COPYFILE_FICLONE,
    });
}
