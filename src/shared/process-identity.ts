/**
 * @module shared/process-identity
 * Stable identity for a process instance, distinct from its recyclable numeric PID.
 *
 * PID liveness alone is insufficient for durable ownership checkpoints: operating
 * systems may reuse a PID after the original owner exits. Record a birth identity
 * alongside PID/host and compare it when resuming.
 */

import { readFile, readlink } from "node:fs/promises";
import { platform } from "node:os";
import process from "node:process";

export type ProcessBirthIdentity = {
    platform: string;
    /** Linux boot and PID namespace identity plus process start ticks. */
    linux?: { bootId: string; pidNamespace: string; startTicks: string };
    /** OS-reported process start time on macOS and Windows. */
    startedAt?: number;
};

/**
 * Read a process birth identity from the OS. Returns undefined when reliable
 * process-birth evidence is unavailable; callers must not guess from timestamps.
 */
export async function getProcessBirthIdentity(pid: number): Promise<ProcessBirthIdentity | undefined> {
    if (!Number.isInteger(pid) || pid <= 0) return undefined;
    const os = platform();

    if (os === "linux") {
        try {
            const [bootId, pidNamespace, stat] = await Promise.all([
                readFile("/proc/sys/kernel/random/boot_id", "utf8"),
                readlink(`/proc/${pid}/ns/pid`),
                readFile(`/proc/${pid}/stat`, "utf8"),
            ]);
            // The comm field is parenthesized and may contain spaces or ')'.
            const close = stat.lastIndexOf(")");
            if (close < 0) return undefined;
            const fields = stat.slice(close + 2).trim().split(/\s+/);
            // /proc/<pid>/stat field 22 (starttime); fields start at field 3.
            const startTicks = fields[19];
            if (!startTicks) return undefined;
            return { platform: os, linux: { bootId: bootId.trim(), pidNamespace, startTicks } };
        } catch {
            return undefined;
        }
    }

    if (os === "darwin" || os === "win32") {
        try {
            const { execFile } = await import("node:child_process");
            const { promisify } = await import("node:util");
            const execFileAsync = promisify(execFile);
            const result = os === "darwin"
                ? await execFileAsync("ps", ["-o", "lstart=", "-p", String(pid)], { timeout: 2_000 })
                : await execFileAsync("powershell.exe", [
                    "-NoProfile", "-NonInteractive", "-Command",
                    `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
                ], { timeout: 2_000 });
            const value = result.stdout.trim();
            if (!value) return undefined;
            if (os === "darwin") {
                const startedAt = Date.parse(value);
                return Number.isFinite(startedAt) ? { platform: os, startedAt } : undefined;
            }
            const startedAt = Number(value);
            return Number.isFinite(startedAt) ? { platform: os, startedAt } : undefined;
        } catch {
            return undefined;
        }
    }
    return undefined;
}

/** Compare process-birth identities; missing evidence is never considered a match. */
export function sameProcessIdentity(
    recorded: ProcessBirthIdentity | undefined,
    current: ProcessBirthIdentity | undefined,
): boolean {
    if (!recorded || !current || recorded.platform !== current.platform) return false;
    if (recorded.platform === "linux") {
        return !!recorded.linux && !!current.linux &&
            recorded.linux.bootId === current.linux.bootId &&
            recorded.linux.pidNamespace === current.linux.pidNamespace &&
            recorded.linux.startTicks === current.linux.startTicks;
    }
    return recorded.startedAt !== undefined &&
        current.startedAt !== undefined &&
        recorded.startedAt === current.startedAt;
}
