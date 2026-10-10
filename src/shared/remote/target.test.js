import { captureForegroundProcess } from "../captured-process.ts";
import {
    chmod as fsChmod,
    mkdir as fsMkdir,
    mkdtemp as fsMkdtemp,
    realpath as fsRealpath,
    rm as fsRm,
    stat as fsStat,
    symlink as fsSymlink,
    writeFile as fsWriteFile,
} from "node:fs/promises";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { resolveRemoteTarget } from "./target.ts";

/** @param {(home: string, ssh: string) => Promise<void>} fn */
async function fixture(fn) {
    const root = await fsRealpath(await fsMkdtemp(join(tmpdir(), "portable-fixture-")));
    try {
        const ssh = join(root, "ssh");
        await fsWriteFile(
            ssh,
            '#!/bin/sh\n[ "$1" = -T ] && [ "$2" = -- ] && [ "$3" = example ] || exit 42\nexec sh -c "$4"\n',
        );
        await fsChmod(ssh, 0o700);
        await fn(root, ssh);
    } finally {
        await fsRm(root, { recursive: true });
    }
}

test("remote paths are resolved relative to remote home with shell characters kept literal", async () => {
    await fixture(async (home, ssh) => {
        const name = "space ' $(touch BAD); folder";
        await fsMkdir(join(home, name));
        // A child receives this HOME directly via the fixture wrapper below; do
        // not modify the test process HOME.
        const wrapper = join(home, "remote-ssh");
        await fsWriteFile(
            wrapper,
            `#!/bin/sh\nHOME=${JSON.stringify(home)} export HOME\nexec ${JSON.stringify(ssh)} "$@"\n`,
        );
        await fsChmod(wrapper, 0o700);
        const result = await resolveRemoteTarget("example", name, wrapper);
        assertEquals(result.cwd, join(home, name));
        assertEquals(result.gitRoot, null);
        assertEquals(result.home, home);
        assertEquals(await fsStat(join(home, "BAD")).then(() => true).catch(() => false), false);
        const defaultTarget = await resolveRemoteTarget("example", null, wrapper);
        assertEquals(defaultTarget.cwd, home);
        await fsSymlink(join(home, name), join(home, "shortcut"));
        assertEquals((await resolveRemoteTarget("example", "~/shortcut", wrapper)).cwd, result.cwd);
        assertEquals((await resolveRemoteTarget("example", join(home, name), wrapper)).cwd, result.cwd);
        await assertRejects(
            () => resolveRemoteTarget("example", "missing", wrapper),
            Error,
            "not an existing directory",
        );
        const denied = join(home, "denied");
        await fsMkdir(denied);
        await fsChmod(denied, 0o000);
        try {
            await assertRejects(() => resolveRemoteTarget("example", denied, wrapper), Error, "not accessible");
        } finally {
            await fsChmod(denied, 0o700);
        }
        await assertRejects(() => resolveRemoteTarget("-oDanger", null, wrapper), Error, "Invalid SSH destination");
    });
});

test("remote Git evidence distinguishes linked worktrees from primary checkout", async () => {
    await fixture(async (home, ssh) => {
        const wrapper = join(home, "remote-ssh");
        await fsWriteFile(
            wrapper,
            `#!/bin/sh\nHOME=${JSON.stringify(home)} export HOME\nexec ${JSON.stringify(ssh)} "$@"\n`,
        );
        await fsChmod(wrapper, 0o700);
        const repo = join(home, "repo");
        /** @param {string[]} args */
        const git = async (args) => {
            const output = await captureForegroundProcess("git", { args, cwd: home });
            if (output.code !== 0) throw new Error(new TextDecoder().decode(output.stderr));
        };
        await git(["init", repo]);
        await git([
            "-C",
            repo,
            "-c",
            "user.name=Test",
            "-c",
            "user.email=t@example.com",
            "commit",
            "--allow-empty",
            "-m",
            "initial",
        ]);
        const linked = join(home, "linked");
        await git(["-C", repo, "worktree", "add", "-b", "linked", linked]);
        const result = await resolveRemoteTarget("example", linked, wrapper);
        assertEquals(result.cwd, linked);
        assertEquals(result.gitRoot, linked);
        assertEquals(result.primaryRoot, repo);
        assertEquals(result.isWorktree, true);
        assertEquals((await resolveRemoteTarget("example", repo, wrapper)).isWorktree, false);
    });
});
