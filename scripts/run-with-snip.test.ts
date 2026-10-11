import { delimiter } from "node:path";
import { runtimeSourceArgs } from "../src/testing/runtime-source-args.ts";
import { makeTempFile } from "../src/testing/temp-file.ts";
import { test } from "node:test";
import {
    chmod as fsChmod,
    mkdtemp as fsMkdtemp,
    readFile as fsReadFile,
    rm as fsRm,
    writeFile as fsWriteFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import process from "node:process";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runBoundedTest, runWithSnip } from "./run-with-snip.ts";

test("runWithSnip preserves compact success output", async () => {
    const root = await fsMkdtemp(join(tmpdir(), "runwield-snip-command-success-"));
    try {
        const snipPath = join(root, "snip");
        await fsWriteFile(
            snipPath,
            "#!/bin/sh\nprintf 'all tests passed\\n'\nprintf 'snip: tracking error: ignored\\n' >&2\n",
        );
        await fsChmod(snipPath, 0o755);

        const result = await runWithSnip("deno", ["test"], {
            env: { PATH: `${root}${delimiter}${process.env["PATH"] || ""}` },
            failureLabel: "tests",
        });

        assertEquals(result, { code: 0, stdout: "all tests passed\n", stderr: "" });
    } finally {
        await fsRm(root, { recursive: true }).catch(() => {});
    }
});

test("runWithSnip stores only Deno failure diagnostics", async () => {
    const root = await fsMkdtemp(join(tmpdir(), "runwield-snip-command-failure-"));
    let failureLogPath = "";
    try {
        const snipPath = join(root, "snip");
        await fsWriteFile(
            snipPath,
            `#!/bin/sh
printf '%s\n' 'Check src/pass.ts' 'running 2 tests from ./sample.test.ts' 'passing ... ok (1ms)' 'failure ... FAILED (2ms)' 'AssertionError: expected true' 'FAILED | 1 passed | 1 failed (3ms)'
printf 'snip: tracking error: test database is read-only\n' >&2
exit 1
`,
        );
        await fsChmod(snipPath, 0o755);

        const result = await runWithSnip("deno", ["test", "sample.test.ts"], {
            env: { PATH: `${root}${delimiter}${process.env["PATH"] || ""}` },
            failureLabel: "tests",
        });
        failureLogPath = result.failureLogPath || "";

        assertEquals(result.code, 1);
        assertEquals(result.stdout, "");
        assertStringIncludes(result.stderr, `tests failed, read the failure log here: ${failureLogPath}`);
        const failureLog = await fsReadFile(failureLogPath, "utf8");
        assertStringIncludes(failureLog, "failure ... FAILED");
        assertStringIncludes(failureLog, "AssertionError: expected true");
        assertEquals(failureLog.includes("Check src/pass.ts"), false);
        assertEquals(failureLog.includes("passing ... ok"), false);
        assertEquals(failureLog.includes("passed"), false);
        assertEquals(failureLog.includes("tracking error"), false);
    } finally {
        if (failureLogPath) await fsRm(failureLogPath).catch(() => {});
        await fsRm(root, { recursive: true }).catch(() => {});
    }
});

test("a timed-out test stops its process and reports the timeout", async () => {
    const pidPath = await makeTempFile({ prefix: "runwield-test-timeout-" });
    let failureLogPath = "";
    try {
        const result = await runBoundedTest(
            runtimeSourceArgs([
                "eval",
                `import { writeFileSync } from "node:fs"; writeFileSync(${
                    JSON.stringify(pidPath)
                }, String(process.pid)); setInterval(() => {}, 1000);`,
            ]),
            { failureLabel: "tests", timeoutMs: 500, command: process.execPath },
        );
        failureLogPath = result.failureLogPath || "";
        assertEquals(result.code, 124);
        assertStringIncludes(result.stderr, "tests timed out");
        assertStringIncludes(await fsReadFile(failureLogPath, "utf8"), "exceeded 0.5s");
        const pid = Number(await fsReadFile(pidPath, "utf8"));
        let stopped = false;
        try {
            process.kill(pid, "SIGTERM");
        } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
            stopped = true;
        }
        assertEquals(stopped, true);
    } finally {
        if (failureLogPath) await fsRm(failureLogPath).catch(() => {});
        await fsRm(pidPath).catch(() => {});
    }
});

test("quiet Snip commands preserve failures from real subprocesses", async () => {
    const success = await runWithSnip(process.execPath, runtimeSourceArgs(["eval", 'console.log("verbose success")']), {
        failureLabel: "quiet success",
        quietOnSuccess: true,
    });
    assertEquals(success, { code: 0, stdout: "", stderr: "" });
    const failure = await runWithSnip(
        process.execPath,
        runtimeSourceArgs(["eval", 'console.error("real failure evidence"); process.exit(7)']),
        {
            failureLabel: "quiet failure",
            quietOnSuccess: true,
        },
    );
    try {
        assertEquals(failure.code, 7);
        assertStringIncludes(await fsReadFile(failure.failureLogPath!, "utf8"), "real failure evidence");
        assertStringIncludes(failure.stderr, failure.failureLogPath!);
    } finally {
        if (failure.failureLogPath) await fsRm(failure.failureLogPath);
    }
});
