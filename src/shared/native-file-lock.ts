/** OS-backed advisory locks shared with Deno and other POSIX flock writers. */
import { closeSync, constants, openSync } from "node:fs";
import { createRequire } from "node:module";
import { platform, versions } from "node:process";
import { getSystemErrorName } from "node:util";

export interface NativeFileLock {
    tryLockSync(exclusive?: boolean): boolean;
    unlockSync(): void;
    close(): void;
}

interface DenoLockRuntime {
    openSync(path: string, options: DenoLockOpenOptions): NativeFileLock;
}
interface DenoLockOpenOptions {
    read: boolean;
    write: boolean;
    create: boolean;
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
export function openNativeFileLock(path: string, create = true): NativeFileLock {
    if (versions.deno) {
        const deno: DenoLockRuntime = Reflect.get(globalThis, "Deno");
        return deno.openSync(path, { read: true, write: true, create, mode: 0o600 });
    }
    const api = getPosixLockAPI();
    let fd = openSync(path, constants.O_RDWR | (create ? constants.O_CREAT : 0), 0o600);
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
