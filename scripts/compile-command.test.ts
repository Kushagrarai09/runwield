import { test } from "node:test";
import { deepStrictEqual, throws } from "node:assert/strict";
import { parseCompileCommand } from "./compile-command.ts";

test("development compile preserves named output, canonical target and expected identity", () => {
    deepStrictEqual(
        parseCompileCommand([
            "--output",
            "a directory/wld",
            "--target=x86_64-unknown-linux-gnu",
            "--expect-build-id=abc",
        ]),
        {
            output: "a directory/wld",
            target: "bun-linux-x64",
            expectBuildId: "abc",
        },
    );
    deepStrictEqual(parseCompileCommand(["--output=wld.exe", "--target", "bun-windows-arm64"]), {
        output: "wld.exe",
        target: "bun-windows-arm64",
    });
    for (const args of [
        ["--output"],
        ["--output="],
        ["--target", "--output", "wld"],
        ["--target", "unsupported"],
        ["--bogus"],
    ]) {
        throws(() => parseCompileCommand(args));
    }
});
