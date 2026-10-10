/** OS-backed advisory locks shared with Deno and other POSIX flock writers. */
import { closeSync, constants, fstatSync, fsyncSync, ftruncateSync, openSync, readSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import { platform, versions } from "node:process";
import { getSystemErrorName } from "node:util";

export interface NativeFileLock {
    tryLockSync(exclusive?: boolean): boolean;
    lockSync(exclusive?: boolean): void;
    lock(exclusive?: boolean): Promise<void>;
    readSnapshotSync(): NativeLockSnapshot;
    replaceTextSync(text: string): void;
    unlockSync(): void;
    close(): void;
}

export interface NativeLockSnapshot {
    text: string;
    size: number;
    mtime: number;
}
interface DenoLockFile {
    tryLockSync(exclusive?: boolean): boolean;
    lockSync(exclusive?: boolean): void;
    lock(exclusive?: boolean): Promise<void>;
    unlockSync(): void;
    close(): void;
    seekSync(offset: number, whence: number): number;
    readSync(buffer: Uint8Array): number | null;
    writeSync(buffer: Uint8Array): number;
    truncateSync(length: number): void;
    syncSync(): void;
    statSync(): { size: number; mtime: Date | null };
}
interface DenoLockRuntime {
    openSync(path: string, options: DenoLockOpenOptions): DenoLockFile;
}
interface DenoLockOpenOptions {
    read: boolean;
    write: boolean;
    create: boolean;
    createNew: boolean;
    mode: number;
}
interface NativeFunction {
    args: string[];
    returns: string;
}
interface LockSymbols {
    flock(fd: number, operation: number): number;
    __error?: () => number;
    __errno_location?: () => number;
}
interface LockLibrary {
    symbols: LockSymbols;
}
interface BunLockFFI {
    dlopen(path: string, functions: Record<string, NativeFunction>): LockLibrary;
    read: { i32(pointer: number): number };
}
interface PosixLockAPI {
    flock(fd: number, operation: number): number;
    errno(): number;
}

let posixAPI: PosixLockAPI | undefined;
function getPosixLockAPI(): PosixLockAPI {
    if (posixAPI) return posixAPI;
    if (!versions.bun || (platform !== "darwin" && platform !== "linux")) {
        throw new Error("Native file locks require Deno or Bun on macOS/Linux");
    }
    // Load the runtime capability only in Bun; the Deno transition path keeps its
    // native implementation. This also keeps bun:ffi out of Deno's module graph.
    const ffi: BunLockFFI = createRequire(import.meta.url)("bun:ffi");
    const errnoSymbol = platform === "darwin" ? "__error" : "__errno_location";
    const library = ffi.dlopen(platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", {
        flock: { args: ["i32", "i32"], returns: "i32" },
        [errnoSymbol]: { args: [], returns: "ptr" },
    });
    const errnoPointer = library.symbols[errnoSymbol];
    if (!errnoPointer) throw new Error(`Native lock library has no ${errnoSymbol}`);
    posixAPI = {
        flock: library.symbols.flock,
        errno: () => ffi.read.i32(errnoPointer()),
    };
    return posixAPI;
}

function lockError(errno: number): NodeJS.ErrnoException {
    const code = getSystemErrorName(-errno);
    return Object.assign(new Error(`flock: ${code}`), { code, errno: -errno, syscall: "flock" });
}

/** Opening does not acquire a lock or truncate an existing lock file. */
export function openNativeFileLock(path: string, create: boolean | "exclusive" = true): NativeFileLock {
    if (versions.deno) {
        const deno: DenoLockRuntime = Reflect.get(globalThis, "Deno");
        let file: DenoLockFile;
        try {
            file = deno.openSync(path, {
                read: true,
                write: true,
                create: create === true,
                createNew: create === "exclusive",
                mode: 0o600,
            });
        } catch (error) {
            if (error instanceof Error) {
                const codes: Record<string, string> = {
                    AlreadyExists: "EEXIST",
                    NotFound: "ENOENT",
                    PermissionDenied: "EACCES",
                    NotADirectory: "ENOTDIR",
                };
                const code = codes[error.name];
                if (code) Object.assign(error, { code });
            }
            throw error;
        }
        return {
            tryLockSync: (exclusive) => file.tryLockSync(exclusive),
            lockSync: (exclusive) => file.lockSync(exclusive),
            lock: (exclusive) => file.lock(exclusive),
            unlockSync: () => file.unlockSync(),
            close: () => file.close(),
            readSnapshotSync() {
                const stat = file.statSync();
                file.seekSync(0, 0);
                const bytes = new Uint8Array(stat.size);
                let offset = 0;
                while (offset < bytes.length) {
                    const count = file.readSync(bytes.subarray(offset));
                    if (count === null || count === 0) break;
                    offset += count;
                }
                return {
                    text: new TextDecoder().decode(bytes.subarray(0, offset)),
                    size: stat.size,
                    mtime: stat.mtime?.getTime() ?? Date.now(),
                };
            },
            replaceTextSync(text) {
                file.truncateSync(0);
                file.seekSync(0, 0);
                const bytes = new TextEncoder().encode(text);
                let offset = 0;
                while (offset < bytes.length) {
                    const count = file.writeSync(bytes.subarray(offset));
                    if (count === 0) throw new Error("Lock metadata write made no progress");
                    offset += count;
                }
                file.syncSync();
            },
        };
    }
    const api = getPosixLockAPI();
    let fd = openSync(
        path,
        constants.O_RDWR | (create ? constants.O_CREAT : 0) | (create === "exclusive" ? constants.O_EXCL : 0),
        0o600,
    );
    function flock(operation: number): boolean {
        if (fd < 0) throw lockError(9); // EBADF: never operate on a reused descriptor.
        for (;;) {
            if (api.flock(fd, operation) === 0) return true;
            const errno = api.errno();
            if (errno === 4) continue; // EINTR does not establish lock ownership.
            if ((operation & 4) !== 0 && errno === (platform === "darwin" ? 35 : 11)) return false;
            throw lockError(errno);
        }
    }
    return {
        tryLockSync(exclusive = false) {
            return flock((exclusive ? 2 : 1) | 4);
        },
        lockSync(exclusive = false) {
            flock(exclusive ? 2 : 1);
        },
        async lock(exclusive = false) {
            while (!flock((exclusive ? 2 : 1) | 4)) {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
        },
        readSnapshotSync() {
            if (fd < 0) throw lockError(9);
            const stat = fstatSync(fd);
            const bytes = new Uint8Array(stat.size);
            let offset = 0;
            while (offset < bytes.length) {
                const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
                if (count === 0) break;
                offset += count;
            }
            return {
                text: new TextDecoder().decode(bytes.subarray(0, offset)),
                size: stat.size,
                mtime: stat.mtime.getTime(),
            };
        },
        replaceTextSync(text) {
            if (fd < 0) throw lockError(9);
            ftruncateSync(fd, 0);
            const bytes = new TextEncoder().encode(text);
            let offset = 0;
            while (offset < bytes.length) {
                const count = writeSync(fd, bytes, offset, bytes.length - offset, offset);
                if (count === 0) throw new Error("Lock metadata write made no progress");
                offset += count;
            }
            fsyncSync(fd);
        },
        unlockSync() {
            flock(8);
        },
        close() {
            if (fd < 0) throw lockError(9);
            const closing = fd;
            fd = -1;
            closeSync(closing);
        },
    };
}
