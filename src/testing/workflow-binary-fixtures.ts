import { symlink } from "node:fs/promises";
import { chmod as fsChmod, mkdir as fsMkdir, readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import { platform } from "node:process";
import { fromFileUrl, join } from "@std/path";

// Only the executable contents are shared. Every fixture has its own command
// paths and logs; PATH still changes so production availability checks run.
const EXECUTABLE = fromFileUrl(new URL("./workflow-binary-fixture.sh", import.meta.url));
const BINARIES = ["mnemoteca", "cymbal", "ketch", "osascript"];

interface WorkflowBinaryFixtureOptions {
    githubUnavailable?: boolean;
}

/** Install only external boundaries used by the default workflow scenarios. */
export async function writeWorkflowBinaryFixtures(
    root: string,
    options: WorkflowBinaryFixtureOptions = {},
): Promise<string> {
    const binDir = join(root, "bin");
    await fsMkdir(binDir, { recursive: true });
    const names = options.githubUnavailable ? [...BINARIES, "gh"] : BINARIES;
    const script = platform === "win32" ? await fsReadFile(EXECUTABLE, "utf8") : "";
    await Promise.all(names.map(async (name) => {
        const path = join(binDir, name);
        // Windows symlink creation can require privileges. Preserve the previous
        // independent-file behavior there without requiring Developer Mode.
        if (platform === "win32") {
            const quotedBinDir = "'" + binDir.replaceAll("'", "'\\''") + "'";
            await fsWriteFile(
                path,
                script
                    .replace("fixture_bin_dir=${0%/*}", `fixture_bin_dir=${quotedBinDir}`)
                    .replace("fixture_name=${0##*/}", `fixture_name='${name}'`),
            );
            await fsChmod(path, 0o755);
        } else {
            await symlink(EXECUTABLE, path);
        }
    }));
    return binDir;
}

/** Fail even if an optional external-call error was caught by the application. */
export async function assertWorkflowBinaryCallsSupported(root: string): Promise<void> {
    let unexpected = "";
    try {
        unexpected = await fsReadFile(join(root, "bin", "unexpected.log"), "utf8");
    } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    if (unexpected) throw new Error(unexpected.trim());
}
