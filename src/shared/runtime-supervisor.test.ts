import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resourceExhaustionMessage } from "./resource-exhaustion.ts";
import { Terminal, spawn as spawnPty } from "bun";

const supervisor = fileURLToPath(new URL("./runtime-supervisor.ts", import.meta.url));
const fixture = fileURLToPath(new URL("./testing/runtime-supervisor-child.ts", import.meta.url));

function run(mode: string, limited = false) {
    const command = limited ? "/bin/sh" : process.execPath;
    const args = limited ? ["-c", 'ulimit -n 64; exec "$@"', "sh", process.execPath, fixture, mode] : [fixture, mode];
    return spawnSync(
        process.execPath,
        [
            "--eval",
            `
        import { superviseRuntime } from ${JSON.stringify(supervisor)};
        process.exitCode = await superviseRuntime(${JSON.stringify(command)}, ${JSON.stringify(args)});
    `,
        ],
        { input: "protocol input\n", encoding: "utf8", timeout: 15_000 },
    );
}

test("resource errors explain descriptor and memory limits through nested causes", () => {
    for (const code of ["EMFILE", "ENFILE", "ENOMEM", "EAGAIN"]) {
        const failure = new Error("operation failed", { cause: Object.assign(new Error("OS error"), { code }) });
        assert.match(
            resourceExhaustionMessage(failure) ?? "",
            code === "ENOMEM" ? /memory/ : code === "EAGAIN" ? /process or thread/ : /open-file limit/,
        );
    }
    const cyclic = new Error("ordinary failure");
    cyclic.cause = cyclic;
    assert.equal(resourceExhaustionMessage(cyclic), null);
    assert.equal(resourceExhaustionMessage("missing file"), null);
});

test("supervisor preserves protocol stdout, input, and ordinary stderr", () => {
    const result = run("stdio");
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "protocol input\n");
    assert.equal(result.stderr, "child diagnostic\n");
});

test("supervisor preserves ordinary exit codes without resource advice", () => {
    const result = run("exit");
    assert.equal(result.status, 17);
    assert.equal(result.stderr, "ordinary failure\n");
});

test("source CLI preserves Bun runtime preloads in the working process", () => {
    const result = spawnSync(
        process.execPath,
        [
            "--preload",
            fileURLToPath(new URL("./testing/runtime-supervisor-preload.ts", import.meta.url)),
            fileURLToPath(new URL("../cli.ts", import.meta.url)),
            "--version",
        ],
        { encoding: "utf8", timeout: 15_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^runwield /);
    assert.equal(result.stderr.match(/supervisor preload:/g)?.length, 2);
});

test("supervisor does not blame a recovered resource error for an ordinary failure", () => {
    const result = run("recovered-resource");
    assert.equal(result.status, 17);
    assert.equal(result.stderr, "EMFILE: recovered earlier\nordinary failure\n");
});

test("supervisor flushes forwarded stderr before the launcher exits", () => {
    const result = run("large-stderr");
    assert.equal(result.status, 17);
    assert.equal(result.stderr, "x".repeat(512_000));
});

test("supervisor does not wait for a service that inherited stderr", () => {
    const started = performance.now();
    const result = run("service");
    const pid = Number(result.stdout.trim());
    try {
        assert.equal(result.status, 0);
        assert.equal(result.stderr, "");
        assert.ok(performance.now() - started < 3000, "a successful command must not wait for its service");
    } finally {
        if (Number.isSafeInteger(pid) && pid > 0) {
            try {
                process.kill(pid, "SIGTERM");
            } catch {
                /* Service already exited. */
            }
        }
    }
});

test(
    "supervisor restores a real terminal after an image-worker descriptor abort",
    {
        skip: process.platform === "win32" ? "POSIX PTY fixture" : false,
        timeout: 10_000,
    },
    async () => {
        let output = "";
        let sawGuidance = () => {};
        const guidance = new Promise<void>((resolve) => {
            sawGuidance = resolve;
        });
        const terminal = new Terminal({
            data(_terminal, bytes) {
                output += Buffer.from(bytes).toString();
                if (output.includes("SUPERVISOR_READY")) sawGuidance();
            },
        });
        const before = {
            input: terminal.inputFlags,
            output: terminal.outputFlags,
            control: terminal.controlFlags,
            local: terminal.localFlags,
        };
        const child = spawnPty(
            [
                process.execPath,
                "--eval",
                `
        import { superviseRuntime } from ${JSON.stringify(supervisor)};
        const code = await superviseRuntime("/bin/sh", ${JSON.stringify(["-c", 'ulimit -n 64; exec "$@"', "sh", process.execPath, fixture, "tty-image-exhaustion"])});
        const hold = setInterval(() => {}, 1000);
        const released = new Promise((resolve) => process.once("SIGTERM", resolve));
        console.log("SUPERVISOR_READY");
        await released;
        clearInterval(hold);
        process.exitCode = code;
    `,
            ],
            { terminal },
        );
        try {
            await guidance;
            assert.equal(terminal.inputFlags, before.input);
            assert.equal(terminal.outputFlags, before.output);
            assert.equal(terminal.controlFlags, before.control);
            // Restoring cooked input can set the transient POSIX PENDIN flag.
            const pendingInput = process.platform === "darwin" ? 0x20000000 : 0x4000;
            assert.equal(terminal.localFlags & ~pendingInput, before.local & ~pendingInput);
            assert.ok(output.includes("\x1b[?2004l\x1b[?1049l\x1b[?25h"));
            assert.match(output, /RunWield reached the open-file limit/);
            child.kill("SIGTERM");
            assert.equal(await child.exited, 134);
        } finally {
            child.kill();
            terminal.close();
        }
    },
);

test("supervisor explains catchable resource failures without replaying a command", () => {
    const result = run("resource-error");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /RunWield reached the open-file limit/);
    assert.match(result.stderr, /not replayed/);
    assert.equal(result.stdout, "attempt\n");
});

test(
    "supervisor survives a real Pi image-worker descriptor abort and explains recovery",
    {
        skip: process.platform === "win32" ? "POSIX descriptor limit fixture" : false,
    },
    () => {
        const result = run("image-exhaustion", true);
        assert.equal(result.error, undefined);
        assert.equal(result.signal, null, "the supervisor itself must not abort");
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /failed to create the event loop/);
        assert.match(result.stderr, /RunWield reached the open-file limit/);
        assert.match(result.stderr, /wld --continue/);
        assert.equal(result.stdout, "");
    },
);

test(
    "supervisor explains native aborts even without a resource diagnostic",
    {
        skip: process.platform === "win32" ? "POSIX SIGABRT fixture" : false,
    },
    () => {
        const result = run("abort");
        assert.equal(result.error, undefined);
        assert.equal(result.signal, null);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /RunWield runtime stopped unexpectedly/);
    },
);

test(
    "supervisor reports exhaustion even when its own child cannot be launched",
    {
        skip: process.platform === "win32" ? "POSIX descriptor limit fixture" : false,
    },
    () => {
        const result = run("supervisor-exhaustion", true);
        assert.equal(result.error, undefined);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /RunWield reached the open-file limit/);
        assert.doesNotMatch(result.stderr, /TypeError|Unhandled|throw er/);
    },
);

for (const signalTarget of ["parent", "group"] as const) {
    test(
        `supervisor preserves termination delivered to its ${signalTarget}`,
        {
            skip: process.platform === "win32" ? "POSIX signal fixture" : false,
            timeout: 10_000,
        },
        async () => {
            const child = spawn(
                process.execPath,
                [
                    "--eval",
                    `
        import { superviseRuntime } from ${JSON.stringify(supervisor)};
        process.exitCode = await superviseRuntime(process.execPath, ${JSON.stringify([fixture, "signal"])});
    `,
                ],
                { stdio: ["ignore", "pipe", "pipe"], detached: true },
            );
            let output = "";
            let errors = "";
            child.stderr.on("data", (chunk: Buffer) => {
                errors += chunk.toString();
            });
            child.stdout.on("data", (chunk: Buffer) => {
                output += chunk.toString();
                if (output.includes("READY")) {
                    if (signalTarget === "group" && child.pid) process.kill(-child.pid, "SIGTERM");
                    else child.kill("SIGTERM");
                }
            });
            try {
                const code = await new Promise<number | null>((resolve, reject) => {
                    child.once("error", reject);
                    child.once("close", resolve);
                });
                assert.equal(code, 23);
                assert.equal(output, "READY\n");
                assert.equal(errors, "");
            } finally {
                if (child.exitCode === null) child.kill("SIGKILL");
            }
        },
    );
}
