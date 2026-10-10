/** Qualify a relocated development executable without touching the user's home. */
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { argv, env, platform } from "node:process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { verifyBuildArtifact } from "./build-metadata.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

async function unusedPort(): Promise<number> {
    const listener = createServer();
    await new Promise<void>((resolve, reject) => {
        listener.once("error", reject);
        listener.listen(0, "127.0.0.1", resolve);
    });
    const address = listener.address();
    if (!address || typeof address === "string") throw new Error("No TCP port allocated");
    await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    return address.port;
}

export async function checkBunPackage(
    path: string,
    assetsDirectory = join(ROOT, "dist/workspace-bun/client"),
): Promise<void> {
    const executable = resolve(path);
    const metadata = await verifyBuildArtifact(executable);
    const home = await mkdtemp(join(tmpdir(), "runwield-bun-package-"));
    try {
        const relocated = join(home, "wld");
        await cp(executable, relocated);
        // Both files must be ignored by the compiled executable.
        await writeFile(join(home, ".env"), "WLD_WORKSPACE_DISABLE_BUILT_SERVER=1\n");
        await writeFile(join(home, "bunfig.toml"), 'preload = ["./unexpected-preload.js"]\n');
        await writeFile(join(home, "unexpected-preload.js"), 'throw new Error("Ambient Bun config executed");\n');
        const childEnv = {
            HOME: home,
            USERPROFILE: home,
            TMPDIR: home,
            TEMP: home,
            TMP: home,
            XDG_CONFIG_HOME: join(home, ".config"),
            XDG_CACHE_HOME: join(home, ".cache"),
            XDG_DATA_HOME: join(home, ".local/share"),
            MNEMOTECA_DB_PATH: join(home, "mnemoteca.db"),
            SNIP_DB_PATH: join(home, "snip.db"),
            PATH: env.PATH || "/usr/bin:/bin",
            WLD_INTERNAL_PACKAGE_CHECK: "1",
        };
        const start = (args: string[]) => {
            // Deny the complete checkout to the executable, including dependencies,
            // while this verifier can still read expected bytes for comparison.
            const sandbox = `(version 1)(allow default)(deny file-read* (subpath ${JSON.stringify(ROOT)}))`;
            const command = platform === "darwin" ? "/usr/bin/sandbox-exec" : relocated;
            const commandArgs = platform === "darwin" ? ["-p", sandbox, relocated, ...args] : args;
            const child = spawn(command, commandArgs, { cwd: home, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
            let output = "";
            child.stdout.setEncoding("utf8").on("data", (chunk: string) => output += chunk);
            child.stderr.setEncoding("utf8").on("data", (chunk: string) => output += chunk);
            const finished = new Promise<number | null>((resolve, reject) => {
                child.once("error", reject);
                child.once("close", resolve);
            });
            return { child, finished, output: () => output };
        };
        for (const args of [["--help"], ["--version"], ["package-smoke", "image-resize"]]) {
            const running = start(args);
            const timeout = setTimeout(() => running.child.kill("SIGKILL"), 30_000);
            try {
                equal(await running.finished, 0, running.output());
                if (args[0] === "--help") match(running.output(), /RunWield.*Plan-by-Default/s);
                else if (args[0] === "--version") ok(running.output().includes(metadata.version));
                else match(running.output(), /Packaged image resize passed/);
            } finally {
                clearTimeout(timeout);
            }
        }
        const port = await unusedPort();
        const running = start(["workspace", "serve", "--port", String(port), "--no-open"]);
        const base = `http://127.0.0.1:${port}`;
        const watchdog = setTimeout(() => running.child.kill("SIGKILL"), 30_000);
        try {
            let page: Response | undefined;
            const deadline = Date.now() + 15_000;
            while (Date.now() < deadline && running.child.exitCode === null) {
                try {
                    page = await fetch(`${base}/pair`, { signal: AbortSignal.timeout(2_000) });
                    break;
                } catch {
                    await delay(50);
                }
            }
            ok(page, running.output());
            equal(page.status, 200, running.output());
            const html = await page.text();
            match(html, /Pair RunWield Workspace/);
            equal(page.headers.get("x-frame-options"), "DENY");
            const assets = [...html.matchAll(/(?:src|href)="(\/_astro\/[^"?]+\.(?:js|css))"/g)].map((item) => item[1]);
            ok(assets.length > 0);
            for (const asset of new Set(assets)) {
                const response = await fetch(`${base}${asset}`, { signal: AbortSignal.timeout(5_000) });
                equal(response.status, 200, asset);
                match(
                    response.headers.get("content-type") || "",
                    asset.endsWith(".css") ? /text\/css/i : /(?:text|application)\/javascript/i,
                );
                deepEqual(
                    new Uint8Array(await response.arrayBuffer()),
                    new Uint8Array(await readFile(join(assetsDirectory, asset))),
                    asset,
                );
            }
            const denied = await fetch(`${base}/api/owner/projects`);
            equal(denied.status, 401);
            await denied.text();
            const invalid = await fetch(`${base}/projects/%/plans`);
            equal(invalid.status, 500);
            equal(await invalid.text(), "Internal Server Error");
            running.child.kill("SIGTERM");
            equal(await running.finished, 0, running.output());
        } finally {
            clearTimeout(watchdog);
            if (running.child.exitCode === null) running.child.kill("SIGKILL");
            await running.finished;
        }
        console.log(
            `Relocated Bun package passed: CLI, worker/WASM, image conversion, Workspace assets/auth, shutdown (${metadata.target}).`,
        );
    } finally {
        await rm(home, { recursive: true, force: true });
    }
}

if (import.meta.main) {
    if (argv.length < 3 || argv.length > 4) {
        throw new Error("Usage: check-bun-package.ts <executable> [expected-assets-directory]");
    }
    await checkBunPackage(argv[2], argv[3]);
}
