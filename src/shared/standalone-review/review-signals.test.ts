import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { defineGitFixture, git } from "../git-test-fixture.ts";
import { resolveReviewTarget } from "./review-target.ts";
import { runStandaloneReview } from "./review-loop.ts";

const fixture = defineGitFixture(async (cwd) => {
    await Deno.writeTextFile(`${cwd}/file.txt`, "base\n");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "base"]);
    await git(cwd, ["branch", "topic"]);
});

for (const hangup of [false, true]) {
    Deno.test(
        hangup
            ? "terminal hangup closes the Engineer Session and settles its worktree"
            : "unsupported signals do not prevent review startup",
        async () => {
            await withRuntimeCommandFixture("review-signals-", async ({ setModelResponseFactories }) => {
                const cwd = await fixture.checkout();
                const target = await resolveReviewTarget(cwd, "topic");
                const listeners = new Map<Deno.Signal, () => void>();
                const add = Deno.addSignalListener;
                const remove = Deno.removeSignalListener;
                const output: string[] = [];
                let browserRun = Promise.resolve();
                Deno.addSignalListener = (signal, listener) => {
                    if (!hangup && signal !== "SIGINT") throw new Error("Signal not supported");
                    listeners.set(signal, listener);
                };
                Deno.removeSignalListener = (signal) => {
                    assertEquals(listeners.has(signal), true);
                    listeners.delete(signal);
                };
                try {
                    setModelResponseFactories([async () => {
                        await Deno.writeTextFile(`${target.worktree!.path}/file.txt`, "Engineer edit\n");
                        return fauxAssistantMessage("Edited.");
                    }]);
                    await runStandaloneReview(target, {
                        print: (text) => output.push(text),
                        browser: {
                            open: (link) => {
                                browserRun = (async () => {
                                    const url = new URL(link);
                                    if (hangup) {
                                        const response = await fetch(
                                            new URL(`/api/review/deny${url.search}`, url),
                                            {
                                                method: "POST",
                                                headers: { "content-type": "application/json" },
                                                body: JSON.stringify({
                                                    conversationTurn: true,
                                                    feedback: "Edit the file",
                                                }),
                                            },
                                        );
                                        await response.text();
                                        for (let i = 0; i < 300; i++) {
                                            const response = await fetch(
                                                new URL(`/api/review/conversation${url.search}`, url),
                                            );
                                            if ((await response.json()).revision > 0) {
                                                const hangupListener = listeners.get("SIGHUP");
                                                if (!hangupListener) {
                                                    throw new Error("Terminal hangup has no cleanup handler");
                                                }
                                                hangupListener();
                                                return;
                                            }
                                            await new Promise((resolve) => setTimeout(resolve, 20));
                                        }
                                        throw new Error("Engineer did not refresh");
                                    }
                                    const response = await fetch(new URL(`/api/review/exit${url.search}`, url), {
                                        method: "POST",
                                    });
                                    await response.text();
                                })();
                                browserRun.catch(() => listeners.get("SIGINT")?.());
                                return Promise.resolve(true);
                            },
                        },
                    });
                    await browserRun;
                    assertEquals(listeners.size, 0);
                    assertStringIncludes(
                        output.join("\n"),
                        hangup ? "Resume Engineer: wld resume" : "No review worktree",
                    );
                    if (hangup) assertStringIncludes(output.join("\n"), "Review worktree kept:");
                } finally {
                    Deno.addSignalListener = add;
                    Deno.removeSignalListener = remove;
                    if (target.worktree) {
                        await Deno.remove(target.worktree.path, { recursive: true }).catch(() => {});
                    }
                    await Deno.remove(cwd, { recursive: true });
                }
            });
        },
    );
}
