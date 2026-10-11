import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { defineGitFixture, git } from "../git-test-fixture.ts";
import { approveAndCommit } from "./review-commit.ts";
const fixture = defineGitFixture(async (cwd) => {
    await Deno.writeTextFile(`${cwd}/base.txt`, "base\n");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "base"]);
});
Deno.test("Operator commit without push names the upstream check and retains commits", async () => {
    await withRuntimeCommandFixture("review-commit-", async ({ setModelResponseFactory }) => {
        const cwd = await fixture.checkout();
        try {
            const before = await git(cwd, ["rev-parse", "HEAD"]);
            await Deno.writeTextFile(`${cwd}/edit.txt`, "reviewed edit\n");
            setModelResponseFactory(async () => {
                await git(cwd, ["add", "."]);
                await git(cwd, ["commit", "-m", "reviewed"]);
                return fauxAssistantMessage("Committed.");
            });
            const result = await approveAndCommit(cwd);
            assertEquals(result.ok, false);
            assertStringIncludes(result.message, "@{u}");
            assertEquals(await git(cwd, ["status", "--porcelain"]), "");
            assertEquals(await git(cwd, ["rev-parse", "HEAD"]) === before, false);
        } finally {
            await Deno.remove(cwd, { recursive: true });
        }
    });
});
Deno.test("detached HEAD refuses before the Operator starts", async () => {
    const cwd = await fixture.checkout();
    try {
        await git(cwd, ["checkout", "--detach"]);
        const result = await approveAndCommit(cwd);
        assertEquals(result.ok, false);
        assertStringIncludes(result.message, "detached HEAD");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});
Deno.test("Operator commit and push succeeds only after Git checks", async () => {
    await withRuntimeCommandFixture("review-commit-push-", async ({ setModelResponseFactory }) => {
        const cwd = await fixture.checkout();
        const remote = await Deno.makeTempDir();
        try {
            await git(remote, ["init", "--bare"]);
            await git(cwd, ["remote", "add", "origin", remote]);
            await git(cwd, ["push", "-u", "origin", "HEAD"]);
            await Deno.writeTextFile(`${cwd}/edit.txt`, "reviewed edit\n");
            setModelResponseFactory(async () => {
                await git(cwd, ["add", "."]);
                await git(cwd, ["commit", "-m", "reviewed"]);
                await git(cwd, ["push"]);
                return fauxAssistantMessage("Pushed.");
            });
            assertEquals((await approveAndCommit(cwd)).ok, true);
        } finally {
            await Deno.remove(cwd, { recursive: true });
            await Deno.remove(remote, { recursive: true });
        }
    });
});

Deno.test("Operator success text cannot replace clean-tree and moved-HEAD checks", async () => {
    await withRuntimeCommandFixture("review-commit-noop-", async ({ setModelResponse }) => {
        const cwd = await fixture.checkout();
        try {
            await Deno.writeTextFile(`${cwd}/edit.txt`, "edit\n");
            setModelResponse("All committed and pushed.");
            const result = await approveAndCommit(cwd);
            assertEquals(result.ok, false);
            assertStringIncludes(result.message, "working tree is not clean");
            assertStringIncludes(result.message, "HEAD did not move");
        } finally {
            await Deno.remove(cwd, { recursive: true });
        }
    });
});

Deno.test("Approve & Commit retries publication of the existing reviewed commit", async () => {
    await withRuntimeCommandFixture("review-commit-retry-", async ({ setModelResponseFactory }) => {
        const cwd = await fixture.checkout();
        const remote = await Deno.makeTempDir();
        try {
            await git(remote, ["init", "--bare"]);
            await git(cwd, ["remote", "add", "origin", remote]);
            await git(cwd, ["push", "-u", "origin", "HEAD"]);
            await Deno.writeTextFile(`${cwd}/edit.txt`, "reviewed edit\n");
            setModelResponseFactory(async () => {
                await git(cwd, ["add", "."]);
                await git(cwd, ["commit", "-m", "reviewed"]);
                return fauxAssistantMessage("Push failed.");
            });
            const state = {};
            assertEquals((await approveAndCommit(cwd, undefined, state)).ok, false);
            const committed = await git(cwd, ["rev-parse", "HEAD"]);
            setModelResponseFactory(async () => {
                await git(cwd, ["push"]);
                return fauxAssistantMessage("Pushed existing commit.");
            });
            assertEquals((await approveAndCommit(cwd, undefined, state)).ok, true);
            assertEquals(await git(cwd, ["rev-parse", "HEAD"]), committed);
        } finally {
            await Deno.remove(cwd, { recursive: true });
            await Deno.remove(remote, { recursive: true });
        }
    });
});
