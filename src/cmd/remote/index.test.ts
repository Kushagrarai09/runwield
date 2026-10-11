import { delimiter } from "node:path";
import { runtimeSourceArgs } from "../../testing/runtime-source-args.ts";
import { captureForegroundProcess } from "../../shared/captured-process.ts";
import { test } from "node:test";
import {
    chmod as fsChmod,
    copyFile as fsCopyFile,
    mkdir as fsMkdir,
    mkdtemp as fsMkdtemp,
    readFile as fsReadFile,
    realpath as fsRealpath,
    rm as fsRm,
    stat as fsStat,
    symlink as fsSymlink,
    writeFile as fsWriteFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import process from "node:process";
import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { fromFileUrl, join, toFileUrl } from "@std/path";
import { parseRemoteDestination } from "./index.ts";

const cli = fromFileUrl(new URL("../../cli.ts", import.meta.url));
const decoder = new TextDecoder();

interface CliResult {
    code: number;
    stdout: string;
    stderr: string;
}

interface RemoteFixture {
    local: string;
    remote: string;
    sshLog: string;
    run: (args: string[], proof?: string) => Promise<CliResult>;
}

/** Run the real CLI with a disposable home and an SSH executable that runs the remote command in a shell. */
async function withRemoteFixture(test: (fixture: RemoteFixture) => Promise<void>): Promise<void> {
    const root = await fsRealpath(await fsMkdtemp(join(tmpdir(), "runwield-fixture-")));
    try {
        const local = join(root, "local");
        const remote = join(root, "remote-home");
        const bin = join(root, "bin");
        const sshLog = join(root, "ssh-args");
        await Promise.all([fsMkdir(local), fsMkdir(remote), fsMkdir(bin)]);
        // Only this SSH subprocess sees a Linux host. The resolver itself still
        // runs unchanged through the actual shell and Python interpreter.
        await fsWriteFile(
            join(root, "sitecustomize.py"),
            'import platform\nplatform.system = lambda: "Linux"\nplatform.machine = lambda: "x86_64"\n',
        );
        await fsWriteFile(
            join(bin, "ssh"),
            `#!/bin/sh
printf '%s\\n' "$@" > "$SSH_LOG"
[ "$1" = -T ] && [ "$2" = -- ] && [ "$#" = 4 ] || exit 42
HOME="$REMOTE_HOME" PYTHONPATH="$REMOTE_PYTHONPATH" export HOME PYTHONPATH
exec /bin/sh -c "$4"
`,
        );
        await fsChmod(join(bin, "ssh"), 0o700);
        // The source checkout has no compiled launcher identity. Supply only that
        // build boundary to the CLI subprocess, without writing into the checkout.
        const identity = join(root, "build-identity.js");
        await fsWriteFile(
            identity,
            `export const BUILD_ID = "${"a".repeat(64)}";\nexport const REMOTE_PROTOCOL_VERSION = 1;\n`,
        );
        // A development launcher requires a local Linux artifact, regardless of the release build version.
        const version = join(root, "version.js");
        await fsWriteFile(version, 'export const VERSION = "development";\n');
        const config = join(root, "deno.json");
        const projectConfig = new URL("../../../deno.json", import.meta.url);
        const { imports } = JSON.parse(await fsReadFile(projectConfig, "utf8"));
        await fsWriteFile(
            config,
            JSON.stringify({
                extends: fromFileUrl(projectConfig),
                // The isolated CLI config has no project lockfile; resolve the just-upgraded Pi packages.
                minimumDependencyAge: 0,
                imports: {
                    ...Object.fromEntries(
                        Object.entries(imports).map(([key, value]) => [
                            key,
                            typeof value === "string" && value.startsWith("./")
                                ? new URL(value, projectConfig).href
                                : value,
                        ]),
                    ),
                    [new URL("../../shared/build-identity.js", import.meta.url).href]: toFileUrl(identity).href,
                    [new URL("../../shared/version.js", import.meta.url).href]: toFileUrl(version).href,
                },
            }),
        );
        const preload = join(root, "build-boundary.ts");
        if (!process.versions.deno) {
            const replacements = {
                [fromFileUrl(new URL("../../shared/build-identity.js", import.meta.url))]: identity,
                [fromFileUrl(new URL("../../shared/version.js", import.meta.url))]: version,
            };
            await fsWriteFile(
                preload,
                `import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
const replacements = ${JSON.stringify(replacements)};
plugin({ name: "fixture-build-boundary", setup(build) {
    build.onResolve({ filter: /(?:build-identity|version)\\.js$/ }, ({ path, importer }) => {
        const target = resolve(dirname(importer), path);
        const replacement = replacements[target];
        if (replacement) return { path: replacement };
    });
}});
`,
            );
        }
        await test({
            local,
            remote,
            sshLog,
            run: async (args, proof) => {
                const output = await captureForegroundProcess(process.execPath, {
                    args: process.versions.deno
                        ? runtimeSourceArgs(["run", "-A", "--quiet", "--config", config, cli, "remote", ...args])
                        : [
                            "run",
                            "--preload",
                            preload,
                            ...runtimeSourceArgs(["run", "-A", cli, "remote", ...args]).slice(1),
                        ],
                    cwd: local,
                    env: {
                        HOME: local,
                        WLD_TEST_SANDBOX_HOME: local,
                        MNEMOTECA_DB_PATH: join(local, "mnemoteca.db"),
                        PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`,
                        SSH_LOG: sshLog,
                        REMOTE_HOME: remote,
                        REMOTE_PYTHONPATH: root,
                        ...(proof === undefined ? {} : { WLD_REMOTE_MODEL_PROOF: proof }),
                    },
                });
                return {
                    code: output.code,
                    stdout: decoder.decode(output.stdout),
                    stderr: decoder.decode(output.stderr),
                };
            },
        });
    } finally {
        await fsRm(root, { recursive: true });
    }
}

test("remote destination separates a directory from an SSH host without changing the host", () => {
    assertEquals(parseRemoteDestination("alias"), { host: "alias", path: null });
    assertEquals(parseRemoteDestination("user@alias:~/repo:branch"), { host: "user@alias", path: "~/repo:branch" });
    assertEquals(parseRemoteDestination("[2001:db8::1]:/srv/repo"), { host: "[2001:db8::1]", path: "/srv/repo" });
    assertEquals(parseRemoteDestination("alias:"), { host: "alias", path: null });
});

test("remote destination rejects option-like and malformed hosts", () => {
    for (const destination of ["", "-oProxyCommand=bad", "-oBad:/repo", ":/repo", "alias name", "[unfinished"]) {
        assertThrows(() => parseRemoteDestination(destination), Error, "Invalid SSH destination");
    }
});

test("remote CLI help and invalid arity do not contact SSH", async () => {
    await withRemoteFixture(async ({ run, sshLog }) => {
        const help = await run(["--help"]);
        assertEquals(help.code, 0);
        assertStringIncludes(help.stdout, "Usage: wld remote <ssh-host>");
        const missing = await run([]);
        assertEquals(missing.code, 1);
        assertStringIncludes(missing.stderr, "Usage: wld remote <ssh-host>");
        const excess = await run(["alias", "other"]);
        assertEquals(excess.code, 1);
        assertEquals(await exists(sshLog), false);
    });
});

test("source remote help works without a generated identity and connection explains the build step", async () => {
    const root = await fsMkdtemp(join(tmpdir(), "runwield-fixture-"));
    try {
        for (const path of ["src/cmd/remote", "src/shared/remote", "scripts"]) {
            await fsMkdir(join(root, path), { recursive: true });
        }
        for (
            const path of [
                "src/cmd/remote/index.ts",
                "src/shared/foreground-process.ts",
                "src/shared/linux-process-group.ts",
                "src/shared/captured-process.ts",
                "src/shared/socket-listener.ts",
                "src/shared/remote/runtime.js",
                "src/shared/remote/target.ts",
                "src/shared/remote/control.ts",
                "src/shared/remote/release-artifact.ts",
                "src/shared/remote/sftp-mount.ts",
                "src/shared/remote/model-proof-config.ts",
                "src/constants.js",
                "runtime-root.js",
                "scripts/build-metadata.js",
                "src/shared/version.js",
            ]
        ) await fsCopyFile(path, join(root, path));
        if (!process.versions.deno) {
            await fsSymlink(
                fromFileUrl(new URL("../../../node_modules", import.meta.url)),
                join(root, "node_modules"),
                "dir",
            );
        }
        const module = await import(toFileUrl(join(root, "src/cmd/remote/index.ts")).href);
        const originalLog = console.log;
        let help = "";
        try {
            console.log = (message: string) => {
                help = message;
            };
            await module.runRemoteCommand(["--help"]);
        } finally {
            console.log = originalLog;
        }
        assertStringIncludes(help, "Usage: wld remote");
        await assertRejects(() => module.runRemoteCommand(["example"]), Error, "scripts/compile.js --output bin/wld");
    } finally {
        await fsRm(root, { recursive: true });
    }
});

test("remote CLI refuses malformed LIVE proof before contacting SSH", async () => {
    await withRemoteFixture(async ({ run, sshLog }) => {
        for (
            const proof of [
                "",
                "{}",
                "not-json",
                '{"provider":"p","modelId":"m","sentinelFile":"../secret"}',
                '{"provider":"p","modelId":"m","sentinelFile":"/tmp/secret"}',
            ]
        ) {
            const result = await run(["alias"], proof);
            assertEquals(result.code, 1);
            assertStringIncludes(result.stderr, "Invalid WLD_REMOTE_MODEL_PROOF");
            assertEquals(await exists(sshLog), false);
        }
    });
});

test("remote CLI rejects an option-like host before invoking SSH", async () => {
    await withRemoteFixture(async ({ run, sshLog }) => {
        const result = await run(["-oProxyCommand=bad"]);
        assertEquals(result.code, 1);
        assertStringIncludes(result.stderr, "Invalid SSH destination");
        assertEquals(await exists(sshLog), false);
    });
});

test("remote CLI resolves a host home without initializing a local project and requires a built artifact", async () => {
    await withRemoteFixture(async ({ run, local, remote, sshLog }) => {
        const result = await run(["remote-alias"]);
        assertEquals(result.code, 1);
        assertStringIncludes(result.stderr, "Missing x86_64-unknown-linux-gnu artifact");
        assertStringIncludes(result.stderr, "scripts/compile.js --target x86_64-unknown-linux-gnu");
        assertEquals((await fsReadFile(sshLog, "utf8")).split("\n").slice(0, 3), ["-T", "--", "remote-alias"]);
        assertEquals(await exists(join(local, ".wld")), false);
        assertEquals(await exists(join(local, ".git")), false);
        assertEquals(await exists(join(remote, ".cache")), false);
    });
});

test("remote CLI keeps shell metacharacters in the target path literal", async () => {
    await withRemoteFixture(async ({ run, remote, sshLog }) => {
        const name = "space ' $(touch BAD); folder";
        await fsMkdir(join(remote, name));
        const result = await run([`remote-alias:${name}`]);
        // Reaching artifact verification proves the existing directory was found.
        assertStringIncludes(result.stderr, "Missing x86_64-unknown-linux-gnu artifact");
        assertEquals(await exists(join(remote, "BAD")), false);
        const sshArgs = await fsReadFile(sshLog, "utf8");
        assertEquals(sshArgs.includes(name), false);
    });
});

test("remote CLI reports an absent remote directory before artifact setup", async () => {
    await withRemoteFixture(async ({ run, remote }) => {
        const result = await run(["remote-alias:missing"]);
        assertEquals(result.code, 1);
        assertStringIncludes(result.stderr, "Remote target is not an existing directory");
        assertEquals(await exists(join(remote, ".cache")), false);
    });
});

async function exists(path: string): Promise<boolean> {
    return await fsStat(path).then(() => true, () => false);
}
