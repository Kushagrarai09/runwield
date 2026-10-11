import { assertEquals, assertStringIncludes } from "@std/assert";
import { defineGitFixture, git } from "../git-test-fixture.ts";
import { resolveReviewTarget, resolveReviewTargetWithForge } from "./review-target.ts";
import { ensureReviewWorktree, settleReviewWorktree } from "./review-worktree.ts";
const fixture = defineGitFixture(async (cwd) => {
    await Deno.writeTextFile(`${cwd}/base.txt`, "base\n");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "base"]);
    await git(cwd, ["branch", "topic"]);
    await git(cwd, ["branch", "--set-upstream-to=main", "topic"]);
});
for (const state of ["clean", "dirty", "unpushed"]) {
    Deno.test(`settle ${state} review checkout protects work`, async () => {
        const cwd = await fixture.checkout();
        let path = "";
        try {
            const target = await resolveReviewTarget(cwd, "topic");
            assertEquals((await git(cwd, ["worktree", "list", "--porcelain"])).match(/worktree /g)?.length, 1);
            const worktree = await ensureReviewWorktree(target);
            path = worktree.path;
            assertEquals(await ensureReviewWorktree(target), worktree);
            if (state !== "clean") await Deno.writeTextFile(`${path}/edit.txt`, "engineer work\n");
            if (state === "unpushed") {
                await git(path, ["add", "."]);
                await git(path, ["commit", "-m", "work"]);
            }
            const result = await settleReviewWorktree(worktree);
            assertEquals(result.removed, state === "clean");
            if (state !== "clean") {
                assertStringIncludes(result.message, path);
                assertStringIncludes(result.message, "topic");
            }
            assertEquals((await git(cwd, ["worktree", "list", "--porcelain"])).includes(path), state !== "clean");
        } finally {
            if (path) await Deno.remove(path, { recursive: true }).catch(() => {});
            await Deno.remove(cwd, { recursive: true });
        }
    });
}
Deno.test("existing branch checkout is reused and never removed", async () => {
    const cwd = await fixture.checkout();
    const path = await Deno.makeTempDir();
    try {
        await git(cwd, ["worktree", "add", path, "topic"]);
        const worktree = await ensureReviewWorktree(await resolveReviewTarget(cwd, "topic"));
        assertEquals(worktree.created, false);
        assertEquals(await Deno.realPath(worktree.path), await Deno.realPath(path));
        assertEquals((await settleReviewWorktree(worktree)).removed, false);
        assertEquals((await Deno.stat(path)).isDirectory, true);
    } finally {
        await Deno.remove(path, { recursive: true });
        await Deno.remove(cwd, { recursive: true });
    }
});

import { makeForgeFixture } from "./forge-test-fixture.ts";
Deno.test("PR worktree checkout retries an occupied branch and removes its clean checkout", async () => {
    const cwd = await fixture.checkout();
    let path = "";
    const commands: string[][] = [];
    try {
        const forge = await makeForgeFixture(cwd);
        const target = await resolveReviewTargetWithForge(
            cwd,
            "https://github.com/org/repo/pull/1",
            forge.runtime,
            (worktreePath) => ({
                runCommand: async (cmd, args) => {
                    commands.push([cmd, ...args]);
                    if (!args.includes("--branch")) {
                        return { exitCode: 1, stdout: "", stderr: "branch already checked out" };
                    }
                    const branch = args[args.indexOf("--branch") + 1];
                    await git(worktreePath, ["switch", "-c", branch]);
                    await git(worktreePath, ["branch", "--set-upstream-to=topic"]);
                    return { exitCode: 0, stdout: "", stderr: "" };
                },
            }),
        );
        assertEquals(target.worktree, undefined);
        const worktree = await ensureReviewWorktree(target);
        path = worktree.path;
        assertEquals(commands[0], ["gh", "pr", "checkout", "1", "--repo", "github.com/org/repo"]);
        assertStringIncludes(commands[1].join(" "), "--branch wld-review/github-1-");
        assertEquals(await git(path, ["rev-parse", "HEAD"]), await git(cwd, ["rev-parse", "topic"]));
        assertEquals((await settleReviewWorktree(worktree)).removed, true);
    } finally {
        if (path) await Deno.remove(path, { recursive: true }).catch(() => {});
        await Deno.remove(cwd, { recursive: true });
    }
});

for (const changed of [false, true]) {
    Deno.test(`failed Forge checkout ${changed ? "preserves edits and blocks Engineer" : "removes unused tree and retries setup"}`, async () => {
        const cwd = await fixture.checkout();
        let path = "";
        let failing = true;
        try {
            const forge = await makeForgeFixture(cwd);
            const target = await resolveReviewTargetWithForge(
                cwd,
                "https://github.com/org/repo/pull/1",
                forge.runtime,
                (worktreePath) => ({
                    runCommand: async () => {
                        path = worktreePath;
                        if (failing) {
                            if (changed) await Deno.writeTextFile(`${path}/keep.txt`, "local work");
                            return { exitCode: 1, stdout: "", stderr: "checkout failed" };
                        }
                        await git(path, ["switch", "-c", "review-ready"]);
                        return { exitCode: 0, stdout: "", stderr: "" };
                    },
                }),
            );
            const { assertRejects } = await import("@std/assert");
            await assertRejects(() => ensureReviewWorktree(target), Error, "checkout failed");
            failing = false;
            if (changed) {
                await assertRejects(() => ensureReviewWorktree(target), Error, "Local work is preserved");
                assertEquals(await Deno.readTextFile(`${path}/keep.txt`), "local work");
            } else {
                assertEquals(target.worktree, undefined);
                const ready = await ensureReviewWorktree(target);
                assertEquals(ready.branch, "review-ready");
            }
        } finally {
            if (path) await Deno.remove(path, { recursive: true }).catch(() => {});
            await Deno.remove(cwd, { recursive: true });
        }
    });
}
