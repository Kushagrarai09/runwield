import { collectProcessOutput } from "../../testing/subprocess-output.ts";
import { runtimeSourceArgs } from "../../testing/runtime-source-args.ts";
import { spawnNativeProcess } from "../foreground-process.ts";
import { getCwd } from "../../constants.js";
import { test } from "node:test";
import process from "node:process";
import { assertEquals } from "@std/assert";
import { withWorkflowMetricsFixture } from "../../testing/workflow-metrics-fixture.ts";

test("a producer lost after a flushed call start leaves no fabricated terminal row", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot, readMetrics }) => {
        const metricsModule = new URL("./metrics.js", import.meta.url).href;
        const script = `const { recordWorkflowMetric, drainWorkflowMetrics } = await import(${
            JSON.stringify(metricsModule)
        });
            await recordWorkflowMetric({ v: 2, category: "tool_usage", event: "tool_call_started",
                recorderId: "crashed_execution", seq: 0, executionId: "crashed_execution",
                callId: "lost_call", toolName: "read" }, (await import("node:process")).argv.slice(2)[0]);
            await drainWorkflowMetrics();
            (await import("node:process")).exit(0);`;
        const child = spawnNativeProcess(process.execPath, {
            args: runtimeSourceArgs(["run", "-A", "--no-check", "-", projectRoot]),
            stdin: "piped",
            stdout: "piped",
            stderr: "piped",
            cwd: getCwd(),
        });
        const writer = child.stdin.getWriter();
        await writer.write(new TextEncoder().encode(script));
        await writer.close();
        const status = await collectProcessOutput(child);
        assertEquals(status.success, true, new TextDecoder().decode(status.stderr));
        const rows = await readMetrics();
        assertEquals(rows.map((row) => [row.event, row.callId]), [["tool_call_started", "lost_call"]]);
    });
});

test("two local producers leave complete JSONL and unique observation IDs", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot, readMetrics }) => {
        const metricsModule = new URL("./metrics.js", import.meta.url).href;
        const script = `const { recordWorkflowMetric, drainWorkflowMetrics } = await import(${
            JSON.stringify(metricsModule)
        });
            for (let seq = 0; seq < 15; seq++) {
                await recordWorkflowMetric({ v: 2, category: "command", event: "command_started",
                    recorderId: (await import("node:process")).argv.slice(2)[1], commandId: (await import("node:process")).argv.slice(2)[1], seq, command: "help",
                    kind: "builtin", sourceSurface: "tui" }, (await import("node:process")).argv.slice(2)[0]);
            }
            await drainWorkflowMetrics();`;
        const run = (id: string) =>
            spawnNativeProcess(process.execPath, {
                args: runtimeSourceArgs(["run", "-A", "--no-check", "-", projectRoot, id]),
                stdin: "piped",
                stdout: "piped",
                stderr: "piped",
                cwd: getCwd(),
            });
        const children = [run("producer_one"), run("producer_two")];
        const results = await Promise.all(children.map(async (child) => {
            const input = child.stdin.getWriter();
            await input.write(new TextEncoder().encode(script));
            await input.close();
            return collectProcessOutput(child);
        }));
        for (const result of results) assertEquals(result.success, true, new TextDecoder().decode(result.stderr));
        const rows = await readMetrics();
        assertEquals(rows.length, 30);
        assertEquals(new Set(rows.map((row) => row.eventId)).size, 30);
        for (const id of ["producer_one", "producer_two"]) {
            assertEquals(
                rows.filter((row) => row.recorderId === id).map((row) => typeof row.seq === "number" ? row.seq : -1)
                    .sort((a, b) => a - b),
                Array.from({ length: 15 }, (_, index) => index),
            );
        }
    });
});
