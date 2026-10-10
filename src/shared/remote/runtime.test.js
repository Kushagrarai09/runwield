import { copyFile, symlink } from "node:fs/promises";
import {
    chmod as fsChmod,
    mkdir as fsMkdir,
    mkdtemp as fsMkdtemp,
    readFile as fsReadFile,
    realpath as fsRealpath,
    rm as fsRm,
    stat as fsStat,
    writeFile as fsWriteFile,
} from "node:fs/promises";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { assertEquals, assertRejects } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { sha256Bytes } from "../../../scripts/build-metadata.js";
import { linuxTarget } from "./runtime.js";

const BUILD_ID = "a".repeat(64);
const PROTOCOL = 1;

/**
 * @typedef {Object} RuntimeFixture
 * @property {string} root
 * @property {string} ssh
 * @property {string} artifact
 * @property {typeof import('./runtime.js')} module
 * @property {FixtureMetadata} metadata
 */
/**
 * @typedef {Object} FixtureMetadata
 * @property {number} schema
 * @property {number} protocol
 * @property {string} buildId
 * @property {string} target
 * @property {string} version
 * @property {string} sha256
 */
/** @param {(fixture: RuntimeFixture) => Promise<void>} fn */
async function fixture(fn) {
    const root = await fsRealpath(await fsMkdtemp(join(tmpdir(), "portable-fixture-")));
    try {
        const shared = join(root, "src/shared");
        const remote = join(shared, "remote");
        await fsMkdir(remote, { recursive: true });
        await fsMkdir(join(root, "scripts"));
        for (
            const [source, destination] of [
                ["src/shared/remote/runtime.js", join(remote, "runtime.js")],
                ["src/shared/remote/target.ts", join(remote, "target.ts")],
            ]
        ) await copyFile(source, destination);
        for (
            const relative of [
                "scripts/build-metadata.js",
                "runtime-root.js",
                "src/constants.js",
                "src/shared/foreground-process.ts",
                "src/shared/linux-process-group.ts",
                "src/shared/captured-process.ts",
            ]
        ) {
            await symlink(new URL("../../../" + relative, import.meta.url), join(root, relative));
        }
        await fsWriteFile(
            join(shared, "build-identity.js"),
            `export const BUILD_ID = '${BUILD_ID}'; export const REMOTE_PROTOCOL_VERSION = ${PROTOCOL};`,
        );
        await fsWriteFile(join(shared, "version.js"), 'export const VERSION = "test-build";');
        const module = await import(toFileUrl(join(remote, "runtime.js")).href);
        const ssh = join(root, "ssh");
        await fsWriteFile(
            ssh,
            `#!/bin/sh\n[ "$1" = -T ] && [ "$2" = -- ] && [ "$3" = example ] || exit 42\nHOME=${
                JSON.stringify(root)
            } export HOME\ntee ${JSON.stringify(join(root, "transfer"))} | sh -c "$4"\n`,
        );
        await fsChmod(ssh, 0o700);
        const artifact = join(root, "artifact");
        const content =
            `#!/bin/sh\n[ "$1" = --remote-preflight ] || exit 2\necho '{"buildId":"${BUILD_ID}","protocol":${PROTOCOL},"version":"test-build"}'\n`;
        await fsWriteFile(artifact, content);
        const checksum = await sha256Bytes(new TextEncoder().encode(content));
        const metadata = {
            schema: 1,
            protocol: PROTOCOL,
            buildId: BUILD_ID,
            target: "x86_64-unknown-linux-gnu",
            version: "test-build",
            sha256: checksum,
        };
        await fsWriteFile(artifact + ".build.json", JSON.stringify(metadata));
        await fn({ root, ssh, artifact, module, metadata });
    } finally {
        await fsRm(root, { recursive: true });
    }
}

test("GNU Linux platform selection rejects unsupported hosts", () => {
    assertEquals(linuxTarget({ os: "Linux", arch: "x86_64" }), "x86_64-unknown-linux-gnu");
    assertEquals(linuxTarget({ os: "Linux", arch: "aarch64" }), "aarch64-unknown-linux-gnu");
    for (const platform of [{ os: "Darwin", arch: "x86_64" }, { os: "Linux", arch: "armv7" }]) {
        try {
            linuxTarget(platform);
            throw new Error("Accepted unsupported platform");
        } catch (error) {
            if (error instanceof Error && error.message === "Accepted unsupported platform") throw error;
        }
    }
});

test("remote cache promotes verified runtime and reuses it after preflight", async () => {
    await fixture(async ({ root, ssh, artifact, module }) => {
        const platform = { os: "Linux", arch: "x86_64" };
        const first = await module.prepareRemoteRuntime("example", platform, artifact, ssh);
        assertEquals(first.reused, false);
        const firstTransferBytes = (await fsStat(join(root, "transfer"))).size;
        assertEquals(((await fsStat(first.path)).mode ?? 0) & 0o777, 0o700);
        const second = await module.prepareRemoteRuntime("example", platform, artifact, ssh);
        assertEquals(second.path, first.path);
        assertEquals(second.reused, true);
        const secondTransferBytes = (await fsStat(join(root, "transfer"))).size;
        assertEquals(secondTransferBytes < firstTransferBytes, true);
        const abandoned = join(first.path, "../.stage-abandoned");
        await fsWriteFile(abandoned, "incomplete");
        await fsWriteFile(first.path, "broken");
        const repaired = await module.prepareRemoteRuntime("example", platform, artifact, ssh);
        assertEquals(repaired.reused, false);
        assertEquals(await fsStat(abandoned).then(() => true).catch(() => false), false);
        assertEquals(await fsReadFile(repaired.path, "utf8"), await fsReadFile(artifact, "utf8"));
    });
});

test("ARM64 GNU metadata selects a separate verified cache entry", async () => {
    await fixture(async ({ ssh, artifact, module, metadata }) => {
        await fsWriteFile(
            artifact + ".build.json",
            JSON.stringify({ ...metadata, target: "aarch64-unknown-linux-gnu" }),
        );
        const result = await module.prepareRemoteRuntime("example", { os: "Linux", arch: "aarch64" }, artifact, ssh);
        assertEquals(result.path.includes("aarch64-unknown-linux-gnu"), true);
        assertEquals(await fsReadFile(result.path, "utf8"), await fsReadFile(artifact, "utf8"));
    });
});

test("concurrent setup leaves a complete runtime for both callers", async () => {
    await fixture(async ({ ssh, artifact, module }) => {
        const platform = { os: "Linux", arch: "x86_64" };
        const [first, second] = await Promise.all([
            module.prepareRemoteRuntime("example", platform, artifact, ssh),
            module.prepareRemoteRuntime("example", platform, artifact, ssh),
        ]);
        assertEquals(first.path, second.path);
        assertEquals(await fsReadFile(first.path, "utf8"), await fsReadFile(artifact, "utf8"));
        assertEquals((await module.prepareRemoteRuntime("example", platform, artifact, ssh)).reused, true);
    });
});

test("missing artifact and incorrect architecture fail before transfer", async () => {
    await fixture(async ({ ssh, artifact, module }) => {
        await assertRejects(
            () => module.prepareRemoteRuntime("example", { os: "Linux", arch: "x86_64" }, artifact + "-absent", ssh),
            Error,
            "--target x86_64-unknown-linux-gnu",
        );
        await assertRejects(
            () => module.prepareRemoteRuntime("example", { os: "Linux", arch: "aarch64" }, artifact, ssh),
            Error,
            "does not match",
        );
    });
});

test("an artifact with forged embedded identity fails remote preflight", async () => {
    await fixture(async ({ root, ssh, artifact, module, metadata }) => {
        await fsWriteFile(
            artifact,
            '#!/bin/sh\necho \'{"buildId":"wrong","protocol":1,"version":"test-build"}\'\n',
        );
        const sha256 = await sha256Bytes(await fsReadFile(artifact));
        await fsWriteFile(artifact + ".build.json", JSON.stringify({ ...metadata, sha256 }));
        await assertRejects(
            () => module.prepareRemoteRuntime("example", { os: "Linux", arch: "x86_64" }, artifact, ssh),
            Error,
            "embedded identity",
        );
        const cached = join(root, ".cache/runwield/runtime", BUILD_ID, metadata.target, sha256, "wld");
        assertEquals(await fsStat(cached).then(() => true).catch(() => false), false);
    });
});

test("a mismatched artifact VERSION fails locally before transfer", async () => {
    await fixture(async ({ ssh, artifact, module, metadata }) => {
        await fsWriteFile(artifact + ".build.json", JSON.stringify({ ...metadata, version: "other-release" }));
        await assertRejects(
            () => module.prepareRemoteRuntime("example", { os: "Linux", arch: "x86_64" }, artifact, ssh),
            Error,
            "artifact VERSION",
        );
    });
});

test("a matching build with a different human version fails remote preflight", async () => {
    await fixture(async ({ ssh, artifact, module, metadata }) => {
        const content = (await fsReadFile(artifact, "utf8")).replace("test-build", "other-release");
        await fsWriteFile(artifact, content);
        const sha256 = await sha256Bytes(await fsReadFile(artifact));
        await fsWriteFile(artifact + ".build.json", JSON.stringify({ ...metadata, sha256 }));
        await assertRejects(
            () => module.prepareRemoteRuntime("example", { os: "Linux", arch: "x86_64" }, artifact, ssh),
            Error,
            "mismatch: version",
        );
    });
});

test("corrupt, mismatched and non-executable artifacts do not become runnable", async () => {
    await fixture(async ({ root, ssh, artifact, module, metadata }) => {
        const platform = { os: "Linux", arch: "x86_64" };
        await fsWriteFile(artifact, "corrupt");
        await assertRejects(() => module.prepareRemoteRuntime("example", platform, artifact, ssh), Error, "checksum");
        await fsWriteFile(artifact, "#!/bin/sh\nexit 1\n");
        const checksum = await sha256Bytes(await fsReadFile(artifact));
        await fsWriteFile(artifact + ".build.json", JSON.stringify({ ...metadata, sha256: checksum }));
        await assertRejects(() => module.prepareRemoteRuntime("example", platform, artifact, ssh), Error, "preflight");
        const cache = join(root, ".cache/runwield/runtime", BUILD_ID, metadata.target, checksum);
        assertEquals(await fsStat(join(cache, "wld")).then(() => true).catch(() => false), false);
        await fsWriteFile(
            artifact + ".build.json",
            JSON.stringify({ ...metadata, sha256: checksum, buildId: "b".repeat(64) }),
        );
        await assertRejects(
            () => module.prepareRemoteRuntime("example", platform, artifact, ssh),
            Error,
            "does not match",
        );
    });
});

for (const [target, arch] of [["bun-linux-arm64", "aarch64"], ["bun-linux-x64", "x86_64"]]) {
    test(`Bun artifact ${target} uses the architecture-matched verified remote cache`, async () => {
        await fixture(async ({ ssh, artifact, module, metadata }) => {
            await fsWriteFile(artifact + ".build.json", JSON.stringify({ ...metadata, target }));
            const result = await module.prepareRemoteRuntime("example", { os: "Linux", arch }, artifact, ssh);
            assertEquals(result.path.includes(module.linuxTarget({ os: "Linux", arch })), true);
            assertEquals(await fsReadFile(result.path, "utf8"), await fsReadFile(artifact, "utf8"));
            await assertRejects(
                () =>
                    module.prepareRemoteRuntime(
                        "example",
                        { os: "Linux", arch: arch === "aarch64" ? "x86_64" : "aarch64" },
                        artifact,
                        ssh,
                    ),
                Error,
                "does not match",
            );
        });
    });
}
