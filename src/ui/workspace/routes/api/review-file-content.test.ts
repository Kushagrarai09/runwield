import { assertEquals } from "@std/assert";
import { defineGitFixture, git } from "../../../../shared/git-test-fixture.ts";
import { reviewFileContentApi } from "./review-file-handlers.ts";

const fixture = defineGitFixture(async (cwd) => {
    await Deno.writeTextFile(`${cwd}/file.txt`, "selected\n\n");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "selected"]);
    await git(cwd, ["branch", "selected"]);
    await Deno.writeTextFile(`${cwd}/checkout-only.txt`, "not reviewed\n");
    await Deno.writeTextFile(`${cwd}/file.txt`, "checkout\n");
});

Deno.test("selected ref file content preserves newlines and does not fall back to checkout files", async () => {
    const cwd = await fixture.checkout();
    try {
        for (const [path, expected] of [["file.txt", "selected\n\n"], ["checkout-only.txt", null]]) {
            const response = await reviewFileContentApi(new Request(`http://localhost/api/file-content?path=${path}`), {
                cwd,
                headRef: "selected",
            });
            assertEquals(response.status, 200);
            assertEquals((await response.json()).newContent, expected);
        }
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("selected ref rejects file content paths outside the review workspace", async () => {
    const cwd = await fixture.checkout();
    try {
        const response = await reviewFileContentApi(new Request("http://localhost/api/file-content?path=../outside"), {
            cwd,
            headRef: "selected",
        });
        assertEquals(response.status, 403);
        await response.text();
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});
