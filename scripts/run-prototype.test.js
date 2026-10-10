import { captureScriptProcess } from "./script-process.ts";
import { runtimeSourceArgs } from "../src/testing/runtime-source-args.ts";
import { getCwd } from "../src/constants.js";
import { test } from "node:test";
import {
    mkdir as fsMkdir,
    mkdtemp as fsMkdtemp,
    readFile as fsReadFile,
    rm as fsRm,
    writeFile as fsWriteFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import process from "node:process";
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
    findTrackedPrototypeArtifacts,
    isSafePrototypeSlug,
    runPrototype,
    validatePrototypeSetup,
} from "./run-prototype.js";

async function makeGitFixture() {
    const dir = await fsMkdtemp(join(tmpdir(), "runwield-fixture-"));
    await captureScriptProcess("git", { args: ["init"], cwd: dir, stdout: "null", stderr: "null" });
    await fsWriteFile(join(dir, ".gitignore"), "prototypes/\n");
    return dir;
}

/** @param {string} dir @param {string} slug @param {string} [task] */
async function makePrototype(dir, slug, task = "deno eval 'console.log(1)'") {
    const root = join(dir, "prototypes", slug);
    await fsMkdir(root, { recursive: true });
    await fsWriteFile(join(root, "README.md"), `# ${slug}\n`);
    await fsWriteFile(join(root, "deno.json"), JSON.stringify({ tasks: { dev: task } }, null, 4));
    return root;
}

test("prototype launcher accepts safe kebab-case slugs only", () => {
    assertEquals(isSafePrototypeSlug("plan-review-toolbar"), true);
    assertEquals(isSafePrototypeSlug("plan2-review"), true);
    assertEquals(isSafePrototypeSlug("PlanReview"), false);
    assertEquals(isSafePrototypeSlug("../escape"), false);
    assertEquals(isSafePrototypeSlug("plan--review"), false);
    assertEquals(isSafePrototypeSlug("plan_review"), false);
});

test("prototype setup requires ignored prototypes root, local deno config, and dev task", async () => {
    const dir = await makeGitFixture();
    try {
        await makePrototype(dir, "happy-path");
        const setup = await validatePrototypeSetup(dir, "happy-path");
        assertEquals(setup.relativeConfigPath, "prototypes/happy-path/deno.json");

        await fsMkdir(join(dir, "prototypes", "missing-dev"), { recursive: true });
        await fsWriteFile(join(dir, "prototypes", "missing-dev", "deno.json"), JSON.stringify({ tasks: {} }));
        await assertRejects(
            () => validatePrototypeSetup(dir, "missing-dev"),
            Error,
            "must define a local tasks.dev command",
        );
    } finally {
        await fsRm(dir, { recursive: true });
    }
});

test("prototype setup fails when the root is not ignored", async () => {
    const dir = await fsMkdtemp(join(tmpdir(), "runwield-fixture-"));
    try {
        await captureScriptProcess("git", { args: ["init"], cwd: dir, stdout: "null", stderr: "null" });
        await makePrototype(dir, "not-ignored");
        await assertRejects(
            () => validatePrototypeSetup(dir, "not-ignored"),
            Error,
            "must be gitignored",
        );
    } finally {
        await fsRm(dir, { recursive: true });
    }
});

test("prototype runner constructs a local deno dev task command with inherited I/O", async () => {
    const dir = await makeGitFixture();
    try {
        await makePrototype(dir, "command-check");
        /** @type {Array<{ command: string, options: import("./script-process.ts").ScriptProcessOptions }>} */
        const calls = [];
        const code = await runPrototype({
            cwd: dir,
            slug: "command-check",
        }, {
            spawn: (command, options) => {
                calls.push({ command, options });
                return { status: Promise.resolve({ success: true, code: 0, signal: null }) };
            },
        });
        assertEquals(code, 0);
        assertEquals(calls.length, 1);
        assertEquals(calls[0].command, process.versions.deno ? process.execPath : "deno");
        assertEquals(calls[0].options.args, ["task", "-c", "prototypes/command-check/deno.json", "dev"]);
        assertEquals(calls[0].options.stdin, "inherit");
        assertEquals(calls[0].options.stdout, "inherit");
        assertEquals(calls[0].options.stderr, "inherit");
    } finally {
        await fsRm(dir, { recursive: true });
    }
});

test("repository has no tracked executable prototype artifacts", async () => {
    assertEquals(await findTrackedPrototypeArtifacts({ cwd: getCwd() }), []);
});

test("prototype launcher executes the configured Deno task and preserves its exit code", async () => {
    const dir = await makeGitFixture();
    try {
        const root = await makePrototype(dir, "real-launch", "deno run -A dev.js");
        await fsWriteFile(
            join(root, "dev.js"),
            'import {writeFile} from "node:fs/promises"; await writeFile("ran.txt", "configured dev task"); process.exit(7);',
        );
        const result = await captureScriptProcess(process.execPath, {
            args: runtimeSourceArgs([
                "run",
                "-A",
                new URL("./run-prototype.js", import.meta.url).pathname,
                "real-launch",
            ]),
            cwd: dir,
            stdout: "piped",
            stderr: "piped",
        });
        assertEquals(await fsReadFile(join(root, "ran.txt"), "utf8"), "configured dev task");
        assertEquals(result.code, 7);
    } finally {
        await fsRm(dir, { recursive: true });
    }
});

test("repository scan catches force-added ignored prototypes and production prototype markers", async () => {
    const dir = await makeGitFixture();
    try {
        const marker = ["THROWAWAY", "PROTOTYPE"].join(" ");
        await makePrototype(dir, "tracked-prototype");
        await fsMkdir(join(dir, "docs"), { recursive: true });
        await fsMkdir(join(dir, "scripts"), { recursive: true });
        await fsMkdir(join(dir, "src", "skills", "prototype"), { recursive: true });
        await fsMkdir(join(dir, "src", "ui", "__fixtures__"), { recursive: true });
        await fsWriteFile(join(dir, "docs", "DesignPrototype.md"), "production docs are guarded\n");
        await fsWriteFile(join(dir, "scripts", "foo.prototype.js"), "export const x = 1;\n");
        await fsWriteFile(join(dir, "scripts", "foo.prototype.test.js"), `// ${marker}\n`);
        await fsWriteFile(join(dir, "src", "skills", "prototype", "helper.js"), `// ${marker}\n`);
        await fsWriteFile(join(dir, "src", "skills", "prototype", "README.md"), `${marker} docs\n`);
        await fsWriteFile(join(dir, "src", "ui", "Widget.prototype.test.js"), "export const x = 1;\n");
        await fsWriteFile(join(dir, "src", "ui", "WidgetPrototype.js"), "export const x = 1;\n");
        await fsWriteFile(join(dir, "src", "ui", "marker.js"), `// ${marker}\n`);
        await fsWriteFile(join(dir, "src", "ui", "__fixtures__", "FixturePrototype.js"), `// ${marker}\n`);
        await captureScriptProcess("git", {
            args: [
                "add",
                "-f",
                "prototypes/tracked-prototype/README.md",
                "docs/DesignPrototype.md",
                "scripts/foo.prototype.js",
                "scripts/foo.prototype.test.js",
                "src/skills/prototype/helper.js",
                "src/skills/prototype/README.md",
                "src/ui/Widget.prototype.test.js",
                "src/ui/WidgetPrototype.js",
                "src/ui/marker.js",
                "src/ui/__fixtures__/FixturePrototype.js",
            ],
            cwd: dir,
            stdout: "null",
            stderr: "null",
        });
        assertEquals(await findTrackedPrototypeArtifacts({ cwd: dir }), [
            "docs/DesignPrototype.md",
            "prototypes/tracked-prototype/README.md",
            "scripts/foo.prototype.js",
            "scripts/foo.prototype.test.js",
            "src/skills/prototype/helper.js",
            "src/ui/Widget.prototype.test.js",
            "src/ui/WidgetPrototype.js",
            "src/ui/marker.js",
        ]);
    } finally {
        await fsRm(dir, { recursive: true });
    }
});
