import { equal, match, ok, throws } from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
    unlinkSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { readLockFileSnapshot, removeLockFileIfSnapshotMatches } from "./lock-file-snapshot.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath, platform, versions } from "node:process";
import { test } from "node:test";
import { openNativeFileLock } from "./native-file-lock.ts";

function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "runwield-native-lock-"));
    return {
        directory,
        path: join(directory, "writer-λ守🔒.lock"),
        close: () => rmSync(directory, { recursive: true }),
    };
}

test("native locks exclude separate descriptors without truncating private lock contents", () => {
    const f = fixture();
    const first = openNativeFileLock(f.path);
    writeFileSync(f.path, "owner evidence");
    const second = openNativeFileLock(f.path, false);
    try {
        equal(first.tryLockSync(true), true);
        equal(second.tryLockSync(true), false);
        equal(second.tryLockSync(false), false);
        equal(first.readSnapshotSync().text, "owner evidence");
        if (platform === "win32") throws(() => readFileSync(f.path));
        else equal(readFileSync(f.path, "utf8"), "owner evidence");
        if (platform !== "win32") equal(statSync(f.path).mode & 0o777, 0o600);
        first.unlockSync();
        equal(readFileSync(f.path, "utf8"), "owner evidence");
        equal(second.tryLockSync(true), true);
        equal(first.tryLockSync(true), false);
        second.unlockSync();
        equal(first.tryLockSync(true), true);
    } finally {
        first.close();
        second.close();
        f.close();
    }
});

test("shared locks coexist and block an exclusive writer until every reader releases", () => {
    const f = fixture();
    const first = openNativeFileLock(f.path);
    const second = openNativeFileLock(f.path);
    const writer = openNativeFileLock(f.path);
    try {
        equal(first.tryLockSync(), true);
        equal(second.tryLockSync(false), true);
        equal(writer.tryLockSync(true), false);
        first.unlockSync();
        equal(writer.tryLockSync(true), false);
        second.unlockSync();
        equal(writer.tryLockSync(true), true);
    } finally {
        first.close();
        second.close();
        writer.close();
        f.close();
    }
});

test("closing releases ownership and a closed handle cannot affect a subsequently opened lock", () => {
    const f = fixture();
    const first = openNativeFileLock(f.path);
    equal(first.tryLockSync(true), true);
    first.close();
    const replacement = openNativeFileLock(f.path);
    const contender = openNativeFileLock(f.path);
    try {
        equal(replacement.tryLockSync(true), true);
        throws(() => first.tryLockSync(true));
        throws(() => first.unlockSync());
        throws(() => first.close());
        equal(contender.tryLockSync(true), false);
        replacement.close();
        equal(contender.tryLockSync(true), true);
    } finally {
        contender.close();
        f.close();
    }
});

test("missing and invalid lock paths fail instead of reporting contention", () => {
    const f = fixture();
    try {
        throws(() => openNativeFileLock(f.path, false), { code: "ENOENT" });
        throws(() => openNativeFileLock(join(f.directory, "missing", "lock")), { code: "ENOENT" });
        throws(() => openNativeFileLock(f.directory));
    } finally {
        f.close();
    }
});

for (const termination of ["close", "crash"]) {
    test(`native lock is released after child ${termination}`, async () => {
        const f = fixture();
        const source = `import { openNativeFileLock } from ${JSON.stringify(
            new URL("./native-file-lock.ts", import.meta.url).href,
        )};
const lock = openNativeFileLock(${JSON.stringify(f.path)});
if (!lock.tryLockSync(true)) throw new Error("Failed to own lock");
console.log("held");
${termination === "close" ? 'process.stdin.once("data", () => { lock.close(); console.log("released"); });' : ""}
setInterval(() => {}, 1000);`;
        const child = spawn(execPath, versions.deno ? ["eval", source] : ["--eval", source], {
            stdio: ["pipe", "pipe", "pipe"],
        });
        const closed = once(child, "close");
        const contender = openNativeFileLock(f.path);
        try {
            const [ready] = await once(child.stdout, "data", { signal: AbortSignal.timeout(10_000) });
            match(String(ready), /held/);
            equal(contender.tryLockSync(true), false);
            if (termination === "close") {
                const released = once(child.stdout, "data", { signal: AbortSignal.timeout(5_000) });
                child.stdin.write("release\n");
                match(String((await released)[0]), /released/);
                equal(child.exitCode, null);
            } else {
                ok(child.kill("SIGKILL"));
                await closed;
            }
            equal(contender.tryLockSync(true), true);
        } finally {
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
            await closed;
            contender.close();
            f.close();
        }
    });
}

test("exclusive lock creation and descriptor writes preserve complete metadata", () => {
    const f = fixture();
    const owner = openNativeFileLock(f.path, "exclusive");
    try {
        owner.lockSync(true);
        const text = "λ守🔒".repeat(8192);
        owner.replaceTextSync(text);
        equal(owner.readSnapshotSync().text, text);
        if (platform === "win32") throws(() => readFileSync(f.path));
        else equal(readFileSync(f.path, "utf8"), text);
        equal(owner.readSnapshotSync().size, new TextEncoder().encode(text).length);
        equal(owner.readSnapshotSync().mtime, statSync(f.path).mtime.getTime());
        throws(() => openNativeFileLock(f.path, "exclusive"), { code: "EEXIST" });
        if (platform === "win32") throws(() => readFileSync(f.path));
        else equal(readFileSync(f.path, "utf8"), text);
        owner.replaceTextSync("short");
        equal(owner.readSnapshotSync().text, "short");
        equal(owner.readSnapshotSync().size, 5);
        if (platform !== "win32") {
            unlinkSync(f.path);
            writeFileSync(f.path, "replacement inode");
            equal(owner.readSnapshotSync().text, "short");
            owner.replaceTextSync("original inode");
            equal(readFileSync(f.path, "utf8"), "replacement inode");
        }
    } finally {
        owner.close();
        f.close();
    }
    throws(() => owner.replaceTextSync("closed"));
    throws(() => owner.readSnapshotSync());
});

test("closed native and Node lock writers retire matching snapshots across timestamp boundaries", async () => {
    const f = fixture();
    try {
        for (const writer of ["native", "node"]) {
            for (let iteration = 0; iteration < 64; iteration++) {
                const text = JSON.stringify({ token: `${writer}-${iteration}`, pid: process.pid });
                if (writer === "native") {
                    const owner = openNativeFileLock(f.path, "exclusive");
                    try {
                        owner.lockSync(true);
                        owner.replaceTextSync(text);
                    } finally {
                        owner.close();
                    }
                } else {
                    const owner = await open(f.path, "wx");
                    try {
                        await owner.writeFile(text);
                        await owner.sync();
                    } finally {
                        await owner.close();
                    }
                }
                if (iteration >= 32) {
                    const seconds = 1_700_000_000 + (iteration - 32) / 10_000;
                    utimesSync(f.path, seconds, seconds);
                }
                const snapshot = await readLockFileSnapshot(f.path);
                ok(snapshot);
                const reader = openNativeFileLock(f.path, false);
                const nativeSnapshot = reader.readSnapshotSync();
                reader.close();
                const stat = statSync(f.path);
                const mtimeNs = statSync(f.path, { bigint: true }).mtimeNs.toString();
                const removed = await removeLockFileIfSnapshotMatches(f.path, snapshot);
                equal(
                    removed,
                    true,
                    JSON.stringify({ writer, iteration, snapshot, nativeSnapshot, mtimeMs: stat.mtimeMs, mtimeNs }),
                );
                equal(existsSync(f.path), false);
            }
        }
    } finally {
        f.close();
    }
});

test("async native lock waits without blocking the owner from releasing", async () => {
    const f = fixture();
    const owner = openNativeFileLock(f.path);
    const waiter = openNativeFileLock(f.path);
    let acquired = false;
    try {
        owner.lockSync(true);
        const waiting = waiter.lock(true).then(() => (acquired = true));
        await new Promise((resolve) => setTimeout(resolve, 30));
        equal(acquired, false);
        owner.unlockSync();
        await waiting;
        equal(acquired, true);
        equal(owner.tryLockSync(true), false);
        waiter.unlockSync();
        equal(owner.tryLockSync(true), true);
    } finally {
        owner.close();
        waiter.close();
        f.close();
    }
});
