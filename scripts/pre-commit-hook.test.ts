import { captureScriptProcess } from "./script-process.ts";
import { test } from "node:test";
import { mkdir as fsMkdir, mkdtemp as fsMkdtemp, rm as fsRm, writeFile as fsWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

const repoRoot = new URL("..", import.meta.url).pathname;

async function run(cwd: string, command: string, args: string[]) {
    const result = await captureScriptProcess(command, {
        args,
        cwd,
        stdout: "piped",
        stderr: "piped",
    });
    const decoder = new TextDecoder();
    return {
        code: result.code,
        stdout: decoder.decode(result.stdout),
        stderr: decoder.decode(result.stderr),
    };
}

test("pre-commit re-stages an intentionally tracked file below an ignore rule", async () => {
    const projectRoot = await fsMkdtemp(join(tmpdir(), "runwield-pre-commit-"));
    try {
        assertEquals((await run(projectRoot, "git", ["init", "--quiet"])).code, 0);
        await fsMkdir(join(projectRoot, ".generated"));
        await fsWriteFile(join(projectRoot, ".gitignore"), ".generated/\n");
        await fsWriteFile(join(projectRoot, ".generated", "types.ts"), "export const value={ready:true}\n");
        assertEquals((await run(projectRoot, "git", ["add", ".gitignore"])).code, 0);
        assertEquals((await run(projectRoot, "git", ["add", "-f", ".generated/types.ts"])).code, 0);

        const hook = join(repoRoot, ".githooks", "pre-commit");
        const result = await run(projectRoot, "/bin/sh", [hook]);

        assertEquals(result.code, 0, `${result.stdout}${result.stderr}`);
        const staged = await run(projectRoot, "git", ["diff", "--cached", "--", ".generated/types.ts"]);
        assertEquals(staged.code, 0);
        assertStringIncludes(staged.stdout, "export const value = { ready: true };");
    } finally {
        await fsRm(projectRoot, { recursive: true });
    }
});
