import { deepEqual, equal, notEqual, ok, throws } from "node:assert/strict";
import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    symlinkSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform } from "node:process";
import { test } from "node:test";
import {
    catalogLockPath,
    ensureProject,
    FileSessionManifestCache,
    listManifests,
    listProjectsFromDisk,
    manifestPath,
    pathExists,
    readJson,
    recoveryDescriptorPath,
    sessionDirForRoot,
    writeManifest,
} from "./file-session-storage.ts";
import type { FileSessionManifest } from "./file-session-store-types.ts";
import { encodeCwdForSessionDir } from "./session-directory-name.ts";

const timestamp = "2026-01-01T00:00:00.000Z";

function fixture() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "portable-session-")));
    const projectRoot = join(root, "project");
    const baseDir = join(root, "sessions");
    mkdirSync(projectRoot);
    const project = ensureProject(baseDir, projectRoot);
    const sessionDir = sessionDirForRoot(baseDir, projectRoot);
    const transcriptPath = join(sessionDir, "transcript.jsonl");
    writeFileSync(transcriptPath, "transcript\n");
    const manifest: FileSessionManifest = {
        version: 1,
        runwieldSessionId: "session",
        projectId: project.projectId,
        transcriptCwd: projectRoot,
        displayName: "first",
        source: "test",
        createdAt: timestamp,
        updatedAt: timestamp,
        currentSegmentId: "segment",
        fence: 0,
        activation: {
            state: "idle",
            phase: null,
            ownerInstanceId: null,
            ownerProcessKind: null,
            operationId: null,
            expectedGeneration: null,
            acquiredAt: null,
            blockedReason: null,
        },
        generation: null,
        segments: [{
            segmentId: "segment",
            runwieldSessionId: "session",
            projectId: project.projectId,
            piSessionId: "pi",
            transcriptPath,
            transcriptCwd: projectRoot,
            ordinal: 0,
            kind: "planning",
            sealedAt: null,
            headerVersion: 3,
            headerTimestamp: timestamp,
            firstCatalogedAt: timestamp,
            lastCatalogedAt: timestamp,
            lineageParentSegmentId: null,
            lineageParentPiSessionId: null,
            lineageGroupKey: null,
            lineageRecordedAt: null,
            sealedByteLength: null,
            sealedDigestHex: null,
            sealedTerminalEntryId: null,
        }],
    };
    const path = manifestPath(sessionDir, "session");
    writeManifest(manifest, path);
    return { root, projectRoot, baseDir, project, sessionDir, transcriptPath, manifest, path };
}

test("portable project identity preserves canonical roots and directory encoding", () => {
    const f = fixture();
    try {
        equal(ensureProject(f.baseDir, f.projectRoot).projectId, f.project.projectId);
        deepEqual(listProjectsFromDisk(f.baseDir), [f.project]);
        equal(encodeCwdForSessionDir("/short/project"), "--short-project--");
        const long = "/" + "long/".repeat(40) + "project";
        equal(encodeCwdForSessionDir(long), "--project-65c718e1fabf34b83185841223db6f3a--");
        notEqual(encodeCwdForSessionDir(long), encodeCwdForSessionDir("/different" + long));
        throws(() => ensureProject(f.baseDir, "relative"), /must be absolute/);
        throws(() => ensureProject(f.baseDir, f.transcriptPath), /must be a directory/);
        if (platform !== "win32") {
            const alias = join(f.root, "alias");
            symlinkSync(f.projectRoot, alias);
            equal(ensureProject(f.baseDir, alias).projectId, f.project.projectId);
            const transcriptAlias = join(f.sessionDir, "alias.jsonl");
            symlinkSync(f.transcriptPath, transcriptAlias);
            equal(catalogLockPath(f.sessionDir, transcriptAlias), catalogLockPath(f.sessionDir, f.transcriptPath));
        }
    } finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});

test("portable filesystem readers distinguish absence, invalid JSON and path errors", () => {
    const f = fixture();
    try {
        const missing = join(f.root, "missing");
        equal(pathExists(missing), false);
        deepEqual(listProjectsFromDisk(missing), []);
        throws(() => readJson(missing), { code: "ENOENT" });
        throws(() => pathExists(join(f.transcriptPath, "child")), { code: "ENOTDIR" });
        throws(() => listProjectsFromDisk(f.transcriptPath), { code: "ENOTDIR" });
        writeFileSync(f.path, "broken json");
        throws(() => readJson(f.path), SyntaxError);
        if (platform !== "win32") {
            const brokenLink = join(f.root, "broken-link");
            symlinkSync(missing, brokenLink);
            equal(pathExists(brokenLink), true);
        }
    } finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});

test("manifest cache observes atomic replacements even with the same length and mtime", () => {
    const f = fixture();
    try {
        const cache = new FileSessionManifestCache(f.baseDir);
        cache.rememberProject(f.project);
        const oldTime = new Date("2026-01-02T00:00:00.000Z");
        utimesSync(f.path, oldTime, oldTime);
        cache.remember(f.path, f.manifest);
        const first = cache.readPath(f.path);
        ok(first);
        first.manifest.displayName = "caller mutation";
        first.manifest.segments[0].transcriptPath = "caller-mutated transcript";
        first.manifest.activation.state = "uncertain";
        equal(cache.readPath(f.path)?.manifest.displayName, "first");
        equal(cache.readPath(f.path)?.manifest.segments[0].transcriptPath, f.transcriptPath);
        equal(cache.readPath(f.path)?.manifest.activation.state, "idle");
        const before = statSync(f.path);
        f.manifest.displayName = "other";
        writeManifest(f.manifest, f.path);
        utimesSync(f.path, oldTime, oldTime);
        equal(statSync(f.path).size, before.size);
        equal(statSync(f.path).mtime.getTime(), before.mtime.getTime());
        equal(cache.readPath(f.path)?.manifest.displayName, "other");
        equal(cache.findByTranscriptPath(f.transcriptPath)?.manifest.displayName, "other");
        rmSync(f.path);
        equal(cache.readPath(f.path), null);
        equal(cache.resolve("session", f.project.projectId)?.manifest.displayName, "other");
        equal(pathExists(f.path), true);
    } finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});

test("recovery preserves damaged manifests and restores transcript-adjacent evidence", () => {
    const f = fixture();
    try {
        deepEqual(readJson(recoveryDescriptorPath(f.transcriptPath)), readJson(f.path));
        writeFileSync(f.path, "corrupt original bytes");
        const recovered = listManifests(f.sessionDir);
        equal(recovered.length, 1);
        equal(recovered[0].manifest.runwieldSessionId, "session");
        const damaged = readdirSync(join(f.sessionDir, ".runwield", "session-bundles", "session"))
            .find((name) => name.startsWith("manifest.json.damaged-"));
        ok(damaged);
        equal(
            readFileSync(join(f.sessionDir, ".runwield", "session-bundles", "session", damaged), "utf8"),
            "corrupt original bytes",
        );
    } finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});
