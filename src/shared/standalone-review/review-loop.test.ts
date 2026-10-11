import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { defineGitFixture, git } from "../git-test-fixture.ts";
import { resolveReviewTarget, resolveReviewTargetWithForge } from "./review-target.ts";
import { runStandaloneReview } from "./review-loop.ts";
const fixture = defineGitFixture(async (cwd) => {
    await Deno.writeTextFile(`${cwd}/base.txt`, "base\n");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "base"]);
    await git(cwd, ["branch", "topic"]);
    await git(cwd, ["branch", "--set-upstream-to=main", "topic"]);
});
interface ConversationStatus {
    revision: number;
    rawPatch: string;
    events: Array<{ delta: string; agentName: string }>;
}
async function status(url: URL): Promise<ConversationStatus> {
    const response = await fetch(new URL(`/api/review/conversation${url.search}`, url));
    return await response.json();
}
async function decide(url: URL, endpoint: string, body: Record<string, string | boolean>) {
    const response = await fetch(new URL(`/api/review/${endpoint}${url.search}`, url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    await response.text();
}
Deno.test("Engineer uses one real saved Session and refreshes its edited worktree diff", async () => {
    await withRuntimeCommandFixture("standalone-loop-", async ({ setModelResponseFactories }) => {
        const cwd = await fixture.checkout();
        let path = "";
        let browserRun = Promise.resolve();
        const output: string[] = [];
        try {
            const target = await resolveReviewTarget(cwd, "topic");
            setModelResponseFactories([
                async () => {
                    path = target.worktree!.path;
                    await Deno.writeTextFile(`${path}/engineer.txt`, "Engineer change\n");
                    return fauxAssistantMessage("I changed the file.");
                },
                async () => {
                    await Deno.writeTextFile(`${path}/engineer.txt`, "Engineer change\nFollow-up edit\n");
                    return fauxAssistantMessage("I kept the earlier edit and applied the follow-up.");
                },
            ]);
            await runStandaloneReview(target, {
                print: (text) => output.push(text),
                browser: {
                    open: (link) => {
                        browserRun = (async () => {
                            const url = new URL(link);
                            const before = await status(url);
                            await decide(url, "deny", { conversationTurn: true, feedback: "Change the file" });
                            for (let i = 0; i < 300; i++) {
                                const next = await status(url);
                                if (next.revision > before.revision) {
                                    try {
                                        assertStringIncludes(next.rawPatch, "+Engineer change");
                                        assertStringIncludes(
                                            next.events.map((event) => event.delta).join(""),
                                            "I changed the file.",
                                        );
                                        assertEquals(next.events[0].agentName, "Engineer");
                                        await decide(url, "deny", {
                                            conversationTurn: true,
                                            feedback: "Make a follow-up edit",
                                        });
                                        let refreshed = false;
                                        for (let j = 0; j < 300; j++) {
                                            const followup = await status(url);
                                            if (followup.revision > next.revision) {
                                                assertStringIncludes(followup.rawPatch, "+Follow-up edit");
                                                assertStringIncludes(
                                                    followup.events.map((event) => event.delta).join(""),
                                                    "applied the follow-up",
                                                );
                                                refreshed = true;
                                                break;
                                            }
                                            await new Promise((resolve) => setTimeout(resolve, 30));
                                        }
                                        assertEquals(refreshed, true);
                                    } finally {
                                        await decide(url, "exit", {});
                                    }
                                    return;
                                }
                                await new Promise((resolve) => setTimeout(resolve, 30));
                            }
                            await decide(url, "exit", {});
                            throw new Error("Engineer did not refresh the diff.");
                        })();
                        // Attach rejection immediately; the assertion is awaited below.
                        browserRun.catch(() => {});
                        return Promise.resolve(true);
                    },
                },
            });
            await browserRun;
            assertEquals(output.filter((line) => line.startsWith("Engineer Session:")).length, 1);
            assertStringIncludes(output.join("\n"), "wld resume");
            assertStringIncludes(output.join("\n"), "kept:");
        } finally {
            if (path) await Deno.remove(path, { recursive: true }).catch(() => {});
            await Deno.remove(cwd, { recursive: true });
        }
    });
});
Deno.test("cancel review makes no commit, creates no worktree, and starts no Engineer", async () => {
    const cwd = await fixture.checkout();
    let browserRun = Promise.resolve();
    const output: string[] = [];
    try {
        const head = await git(cwd, ["rev-parse", "HEAD"]);
        const worktrees = await git(cwd, ["worktree", "list", "--porcelain"]);
        await runStandaloneReview(await resolveReviewTarget(cwd, "topic"), {
            print: (text) => output.push(text),
            browser: {
                open: (link) => {
                    browserRun = decide(new URL(link), "exit", {});
                    return Promise.resolve(true);
                },
            },
        });
        await browserRun;
        assertEquals(await git(cwd, ["rev-parse", "HEAD"]), head);
        assertEquals(await git(cwd, ["worktree", "list", "--porcelain"]), worktrees);
        assertEquals(output.some((line) => line.startsWith("Engineer Session:")), false);
        assertStringIncludes(output.join("\n"), "No review worktree");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

import { makeForgeFixture } from "./forge-test-fixture.ts";
Deno.test("Post comments submits once, shows completion, and ends without Engineer workspace", async () => {
    const cwd = await fixture.checkout();
    let browserRun = Promise.resolve();
    try {
        const forge = await makeForgeFixture(cwd);
        const target = await resolveReviewTargetWithForge(
            cwd,
            "https://github.com/org/repo/pull/1",
            forge.runtime,
            () => forge.runtime,
        );
        await runStandaloneReview(target, {
            print: () => {},
            browser: {
                open: (link) => {
                    browserRun = (async () => {
                        const url = new URL(link);
                        await decide(url, "feedback", { reviewAction: "post_comments", feedback: "Review notes" });
                        for (let i = 0; i < 150; i++) {
                            const response = await fetch(new URL(`/api/review/conversation${url.search}`, url));
                            const next = await response.json();
                            if (next.completed) {
                                assertStringIncludes(next.resultMessage, "Comments posted");
                                return;
                            }
                            await new Promise((resolve) => setTimeout(resolve, 20));
                        }
                        throw new Error("No completed result.");
                    })();
                    browserRun.catch(() => {});
                    return Promise.resolve(true);
                },
            },
        });
        await browserRun;
        assertEquals(forge.submissions.length, 1);
        assertEquals(target.worktree, undefined);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});
Deno.test("a changed PR head refuses submission, refreshes the diff, and stays open for cancellation", async () => {
    const cwd = await fixture.checkout();
    let browserRun = Promise.resolve();
    const output: string[] = [];
    try {
        const forge = await makeForgeFixture(cwd);
        const target = await resolveReviewTargetWithForge(
            cwd,
            "https://github.com/org/repo/pull/1",
            forge.runtime,
            () => forge.runtime,
        );
        await runStandaloneReview(target, {
            print: (text) => output.push(text),
            browser: {
                open: (link) => {
                    browserRun = (async () => {
                        const url = new URL(link);
                        const before = await status(url);
                        await git(cwd, ["switch", "topic"]);
                        await Deno.writeTextFile(`${cwd}/moved.txt`, "remote head change\n");
                        await git(cwd, ["add", "."]);
                        await git(cwd, ["commit", "-m", "remote move"]);
                        const moved = await git(cwd, ["rev-parse", "HEAD"]);
                        await git(cwd, ["update-ref", "refs/pull/1/head", moved]);
                        await git(cwd, ["switch", "main"]);
                        forge.moveHead(moved);
                        await decide(url, "feedback", { reviewAction: "post_comments", feedback: "review notes" });
                        for (let i = 0; i < 200; i++) {
                            const next = await status(url);
                            if (next.revision > before.revision) {
                                try {
                                    assertStringIncludes(next.rawPatch, "+remote head change");
                                } finally {
                                    await decide(url, "exit", {});
                                }
                                return;
                            }
                            await new Promise((resolve) => setTimeout(resolve, 20));
                        }
                        await decide(url, "exit", {});
                        throw new Error("Review did not refresh after refusal.");
                    })();
                    browserRun.catch(() => {});
                    return Promise.resolve(true);
                },
            },
        });
        await browserRun;
        assertEquals(forge.submissions.length, 0);
        assertStringIncludes(output.join("\n"), "head changed");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});
