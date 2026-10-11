import { assertEquals, assertStringIncludes } from "@std/assert";
import { defineGitFixture, git } from "../git-test-fixture.ts";
import { makeForgeFixture } from "./forge-test-fixture.ts";
import { refreshPRTarget, resolveReviewTargetWithForge } from "./review-target.ts";
import { ensureReviewWorktree } from "./review-worktree.ts";
const fixture = defineGitFixture(async (cwd) => {
    await Deno.writeTextFile(`${cwd}/base.txt`, "base\n");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "base"]);
    await git(cwd, ["switch", "-c", "topic"]);
    await Deno.writeTextFile(`${cwd}/topic.txt`, "topic\n");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "topic"]);
    await git(cwd, ["switch", "main"]);
});
for (const state of ["clean", "dirty", "committed", "rewritten"]) {
    Deno.test(`PR refresh ${state === "clean" ? "advances unchanged clean checkout" : `preserves ${state} checkout`}`, async () => {
        const cwd = await fixture.checkout();
        let path = "";
        try {
            const forge = await makeForgeFixture(cwd);
            const target = await resolveReviewTargetWithForge(
                cwd,
                "https://github.com/org/repo/pull/1",
                forge.runtime,
                (dir) => ({
                    runCommand: async () => {
                        await git(dir, ["switch", "-c", "review"]);
                        return { stdout: "", stderr: "", exitCode: 0 };
                    },
                }),
            );
            if (target.mode !== "pr") throw new Error("Expected PR");
            path = (await ensureReviewWorktree(target)).path;
            if (state === "dirty" || state === "committed") {
                await Deno.writeTextFile(`${path}/local.txt`, "keep local\n");
                if (state === "committed") {
                    await git(path, ["add", "."]);
                    await git(path, ["commit", "-m", "local"]);
                }
            }
            const previous = await git(path, ["rev-parse", "HEAD"]);
            await git(cwd, ["switch", "topic"]);
            if (state === "rewritten") await git(cwd, ["reset", "--soft", "main"]);
            await Deno.writeTextFile(`${cwd}/new.txt`, "new PR head\n");
            await git(cwd, ["add", "."]);
            await git(cwd, ["commit", "-m", "PR advanced"]);
            const next = await git(cwd, ["rev-parse", "HEAD"]);
            await git(cwd, ["update-ref", "refs/pull/1/head", next]);
            forge.moveHead(next);
            await refreshPRTarget(target);
            assertEquals(target.metadata.headSha, next);
            assertEquals(await git(path, ["rev-parse", "HEAD"]), state === "clean" ? next : previous);
            if (state === "clean") assertStringIncludes(await target.computeDiff(), "+new PR head");
            else {assertStringIncludes(
                    target.recoveryReason || "",
                    state === "rewritten" ? "cannot fast-forward" : "preserved",
                );}
            if (state === "dirty" || state === "committed") {
                assertEquals(await Deno.readTextFile(`${path}/local.txt`), "keep local\n");
            }
        } finally {
            if (path) await Deno.remove(path, { recursive: true });
            await Deno.remove(cwd, { recursive: true });
        }
    });
}
