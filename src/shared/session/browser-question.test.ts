import { test } from "node:test";
import process from "node:process";
import { assertEquals } from "@std/assert";
import { getCwd } from "../../constants.js";
import { captureForegroundProcess } from "../captured-process.ts";
import { runtimeSourceArgs } from "../../testing/runtime-source-args.ts";

for (const mode of ["answer", "cancel", "bounded-drain"]) {
    test(`browser question shutdown preserves response and terminates: ${mode}`, async () => {
        // A child process makes an uncaught native HTTP lifecycle error fail this test.
        const script = `
import process from "node:process";
import { startBrowserQuestionServer } from ${JSON.stringify(new URL("./browser-question.ts", import.meta.url).href)};
const entered = Promise.withResolvers();
const payload = "answer delivered ".repeat(5000);
const mode = ${JSON.stringify(mode)};
const question = startBrowserQuestionServer({
    interaction: { type: "text", prompt: "probe" },
    answerQuestion: async (request) => {
        entered.resolve();
        await request.text();
        return new Response(payload);
    },
});
const upload = mode === "answer" ? "answer=yes" : new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("answer=")); },
});
const response = fetch(new URL("/api/session-question/answer?token=" + question.token, question.url), {
    method: "POST", body: upload, duplex: "half",
}).then(async (value) => ({ status: value.status, text: await value.text() })).catch(() => null);
await entered.promise;
await question.shutdown({ drain: mode !== "cancel" });
const result = await response;
if (mode === "answer" && (result?.status !== 200 || result.text !== payload)) throw new Error("Answer was truncated");
console.log("shutdown completed");
process.exit(0);
`;
        const result = await captureForegroundProcess(process.execPath, {
            args: runtimeSourceArgs(["eval", script]),
            cwd: getCwd(),
            signal: AbortSignal.timeout(5_000),
        });
        assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
        assertEquals(new TextDecoder().decode(result.stdout).trim(), "shutdown completed");
    });
}
