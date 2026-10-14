/** Real child-process failure scenarios. Never run inside the test runner. */
import process from "node:process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resizeImage } from "@earendil-works/pi-coding-agent";
import { superviseRuntime } from "../runtime-supervisor.ts";

const mode = process.argv[2];
if (process.platform === "linux" && ["abort", "image-exhaustion", "tty-image-exhaustion"].includes(mode)) {
    console.error("Native crash fixture:", process.pid, readFileSync("/proc/sys/kernel/core_pattern", "utf8").trim());
}
if (mode === "image-exhaustion" || mode === "supervisor-exhaustion" || mode === "tty-image-exhaustion") {
    if (mode === "tty-image-exhaustion") {
        process.stdin.setRawMode(true);
        process.stdout.write("\x1b[?1049h\x1b[?2004h\x1b[?25l");
    }
    const descriptors: number[] = [];
    try {
        while (true) descriptors.push(openSync(process.platform === "win32" ? "NUL" : "/dev/null", "r"));
    } catch {
        // Hold the descriptors while Pi tries to start its real image worker.
    }
    try {
        const png =
            "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGP4z8AARwzIHABvqgf5gNwAKAAAAABJRU5ErkJggg==";
        if (mode === "supervisor-exhaustion") {
            process.exitCode = await superviseRuntime(process.execPath, ["--version"]);
        } else {
            await resizeImage(Buffer.from(png, "base64"), "image/png", { maxWidth: 2, maxHeight: 2 });
        }
    } finally {
        for (const descriptor of descriptors) closeSync(descriptor);
    }
} else if (mode === "stdio") {
    for await (const chunk of process.stdin) process.stdout.write(chunk);
    process.stderr.write("child diagnostic\n");
} else if (mode === "resource-error") {
    console.log("attempt");
    throw Object.assign(new Error("Cannot start an operation"), { code: "EMFILE" });
} else if (mode === "abort") {
    process.abort();
} else if (mode === "recovered-resource") {
    console.error("EMFILE: recovered earlier");
    console.error("ordinary failure");
    process.exit(17);
} else if (mode === "large-stderr") {
    process.stderr.write("x".repeat(512_000), () => process.exit(17));
} else if (mode === "service") {
    const service = spawn(process.execPath, ["--eval", "setTimeout(() => {}, 5000)"], {
        stdio: ["ignore", "ignore", "inherit"],
        detached: true,
    });
    console.log(service.pid);
    service.unref();
} else if (mode === "signal") {
    process.on("SIGTERM", () => process.exit(23));
    console.log("READY");
    setInterval(() => {}, 1000);
} else if (mode === "exit") {
    console.error("ordinary failure");
    process.exit(17);
} else {
    throw new Error(`Unknown supervisor fixture: ${mode}`);
}
