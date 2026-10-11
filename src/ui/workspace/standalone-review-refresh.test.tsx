// @ts-nocheck: browser tests install happy-dom globals around the real React surface.
import { assertEquals, assertStringIncludes } from "@std/assert";
import { Window } from "happy-dom";
import { act } from "react";
import { build, stop } from "esbuild";
import { fromFileUrl } from "@std/path";

Deno.test("refused PR post invalidates old annotations and marks the retained guide stale", async () => {
    const bundle = await build({
        entryPoints: [fromFileUrl(new URL("./react/CodeReviewSurface.tsx", import.meta.url))],
        banner: {
            js: `import { createRequire } from "node:module"; const nodeRequire = createRequire(${
                JSON.stringify(import.meta.url)
            }); const require = (id) => nodeRequire(id.startsWith("file:") ? new URL(id).pathname : id);`,
        },
        define: { "import.meta.env": "{}" },
        bundle: true,
        write: false,
        format: "esm",
        jsx: "automatic",
        loader: { ".css": "empty", ".png": "dataurl" },
        alias: {
            "@plannotator/shared": fromFileUrl(
                new URL("../../../third_party/plannotator/packages/shared", import.meta.url),
            ),
            "@plannotator/core": fromFileUrl(
                new URL("../../../third_party/plannotator/packages/core", import.meta.url),
            ),
            "@plannotator/ui": fromFileUrl(new URL("../../../third_party/plannotator/packages/ui", import.meta.url)),
            "@plannotator/guide-viewer": fromFileUrl(
                new URL("../../../third_party/plannotator/packages/guide-viewer", import.meta.url),
            ),
        },
        plugins: [{
            name: "shared-react",
            setup(builder) {
                builder.onResolve(
                    { filter: /\?worker&inline$/ },
                    (args) => ({ path: args.path, namespace: "browser-worker" }),
                );
                builder.onLoad(
                    { filter: /.*/, namespace: "browser-worker" },
                    () => ({ contents: "export default Worker;", loader: "js" }),
                );
                builder.onResolve(
                    { filter: /^react(?:-dom)?(?:\/.*)?$/ },
                    (args) => ({ path: import.meta.resolve(args.path), external: true }),
                );
            },
        }],
    });
    stop();
    const browser = new Window({ url: "http://localhost/review" });
    const names = [
        "addEventListener",
        "removeEventListener",
        "window",
        "document",
        "navigator",
        "location",
        "localStorage",
        "matchMedia",
        "getComputedStyle",
        "HTMLButtonElement",
        "HTMLInputElement",
        "HTMLTextAreaElement",
        "SVGElement",
        "CSSStyleSheet",
        "NodeFilter",
        "customElements",
        "HTMLElement",
        "Element",
        "Node",
        "CustomEvent",
        "MutationObserver",
        "ResizeObserver",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "IS_REACT_ACT_ENVIRONMENT",
        "fetch",
    ];
    browser.document.fonts = new browser.EventTarget();
    const previous = new Map(names.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    let root;
    const submitted = [];
    let revision = 0;
    const patch = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
    try {
        for (const name of names) {
            const value = name === "IS_REACT_ACT_ENVIRONMENT"
                ? true
                : typeof browser[name] === "function"
                ? browser[name].bind(browser)
                : browser[name];
            Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
        }
        globalThis.fetch = (url, options) => {
            if (String(url).includes("/feedback")) {
                submitted.push(JSON.parse(options.body));
                revision++;
                return Promise.resolve(Response.json({ ok: true }));
            }
            if (String(url).includes("/status")) {
                return Promise.resolve(Response.json({
                    revision,
                    gitRef: revision ? "next-head" : "old-head",
                    rawPatch: patch,
                    standaloneReview: {
                        mode: "pr",
                        forge: { available: true, postEnabled: true },
                        resultMessage: "PR head changed",
                    },
                }));
            }
            return Promise.resolve(Response.json({ available: false, providers: [] }));
        };
        const { CodeReviewSurface } = await import(
            `data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`
        );
        const container = browser.document.createElement("div");
        browser.document.body.append(container);
        const { createRoot } = await import("react-dom/client");
        root = createRoot(container);
        await act(() =>
            root.render(
                <CodeReviewSurface
                    payload={{
                        mode: "standalone",
                        token: "fixture",
                        rawPatch: patch,
                        gitRef: "old-head",
                        conversationStatusUrl: "/status",
                        feedbackUrl: "/feedback",
                        agentLabel: "Engineer",
                        standaloneReview: { mode: "pr", forge: { available: true, postEnabled: true } },
                        guidedReview: { mode: "manual" },
                        guidedReviewFixture: {
                            schemaVersion: "1.0",
                            title: "Retained guide",
                            sections: [],
                            everythingElse: [],
                        },
                    }}
                />,
            )
        );
        const button = (text) =>
            [...container.querySelectorAll("button")].find((node) => node.textContent.trim() === text);
        await act(() => button("Global comment").click());
        const input = browser.document.querySelector('textarea[placeholder="Add a global comment..."]');
        await act(() => {
            Object.getOwnPropertyDescriptor(browser.HTMLTextAreaElement.prototype, "value").set.call(
                input,
                "old anchored note",
            );
            input.dispatchEvent(new browser.Event("input", { bubbles: true }));
        });
        const add = [...browser.document.querySelectorAll("button")].find((node) => node.textContent.trim() === "Add");
        await act(() => add.click());
        assertStringIncludes(container.textContent, "old anchored note");
        await act(() => button("Post comments").click());
        assertEquals(submitted[0].annotations.length, 1);
        assertEquals(container.textContent.includes("old anchored note"), false);
        await act(() => button("Guided Review ready").click());
        assertStringIncludes(container.textContent, "Generated on a different version of this branch");
        await act(() => button("Post comments").click());
        assertEquals(submitted[1].annotations, []);
        await act(() => root.unmount());
        root = null;
    } finally {
        if (root) await act(() => root.unmount());
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
        await browser.happyDOM.close();
    }
});
