import { test } from "node:test";
import { mkdtemp as fsMkdtemp, rm as fsRm, writeFile as fsWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { assertRejects } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { runGoldenScenarioChildProcess } from "./child-protocol.js";
import { GOLDEN_CHILD_READY_MARKER } from "./subprocess-runner.js";

test("Golden scenarios reject a timeout even after the child reports success", async () => {
    const fixtureRoot = await fsMkdtemp(join(tmpdir(), "golden-success-then-hang-"));
    const scenarioPath = join(fixtureRoot, "hanging-scenario.ts");
    try {
        await fsWriteFile(
            scenarioPath,
            [
                `console.log(${JSON.stringify(GOLDEN_CHILD_READY_MARKER)});`,
                "console.log(JSON.stringify({ ok: true, result: { actor: { remaining: [] } } }));",
                "await new Promise((resolve) => setTimeout(resolve, 60_000));",
                "export const hangingScenario = {};",
                "",
            ].join("\n"),
        );
        await assertRejects(
            () =>
                runGoldenScenarioChildProcess({
                    scenarioModule: toFileUrl(scenarioPath).href,
                    exportName: "hangingScenario",
                    timeoutMs: 1000,
                }),
            Error,
            "Golden child failed (timeout)",
        );
    } finally {
        await fsRm(fixtureRoot, { recursive: true });
    }
});

test("expected-clean-exit scenarios reject a nonzero child exit after the pre-exit report", async () => {
    const fixtureRoot = await fsMkdtemp(join(tmpdir(), "golden-clean-exit-crash-"));
    const scenarioPath = join(fixtureRoot, "crashing-scenario.ts");
    try {
        await fsWriteFile(
            scenarioPath,
            [
                'import process from "node:process";',
                'if (process.env.WLD_GOLDEN_TUI_CHILD === "1") {',
                '    console.log(JSON.stringify({ ok: true, expectedCleanExit: true, result: { name: "crash", state: {}, events: [], actor: { remaining: [] } } }));',
                "    process.exit(7);",
                "}",
                'export const crashingScenario = { name: "crash", expectedCleanExit: true, assertions: [] };',
                "",
            ].join("\n"),
        );

        await assertRejects(
            () =>
                runGoldenScenarioChildProcess({
                    scenarioModule: toFileUrl(scenarioPath).href,
                    exportName: "crashingScenario",
                    timeoutMs: 10_000,
                }),
            Error,
            "Golden child failed",
        );
    } finally {
        await fsRm(fixtureRoot, { recursive: true });
    }
});
