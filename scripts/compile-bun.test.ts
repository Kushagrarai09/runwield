import { test } from "node:test";
import { assertEquals, assertThrows } from "@std/assert";
import { bunArtifactTarget } from "./compile-bun.ts";

test("Bun artifacts keep release platform triples across every supported compiler target", () => {
    for (const [compiler, artifact] of [
        ["bun-darwin-arm64", "aarch64-apple-darwin"],
        ["bun-darwin-x64", "x86_64-apple-darwin"],
        ["bun-linux-arm64", "aarch64-unknown-linux-gnu"],
        ["bun-linux-x64", "x86_64-unknown-linux-gnu"],
        ["bun-windows-arm64", "aarch64-pc-windows-msvc"],
        ["bun-windows-x64", "x86_64-pc-windows-msvc"],
    ])
        assertEquals(bunArtifactTarget(compiler), artifact);
    assertThrows(() => bunArtifactTarget("bun-freebsd-x64"), Error, "Unsupported Bun target");
});
