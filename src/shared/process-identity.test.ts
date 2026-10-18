import { equal, notEqual } from "node:assert/strict";
import { test } from "node:test";
import { getProcessBirthIdentity, sameProcessIdentity } from "./process-identity.ts";

test("process birth identity is available for the current process when supported", async () => {
    const identity = await getProcessBirthIdentity(process.pid);
    // Unsupported platforms or restricted environments may not expose process birth identity.
    if (!identity) return;
    equal(typeof identity.platform, "string");
    if (identity.platform === "linux") {
        equal(typeof identity.linux?.bootId, "string");
        equal(typeof identity.linux?.pidNamespace, "string");
        equal(typeof identity.linux?.startTicks, "string");
    } else {
        equal(typeof identity.startedAt, "number");
    }
});

test("process identities require positive matching birth evidence", () => {
    const linuxA = {
        platform: "linux",
        linux: { bootId: "boot", pidNamespace: "pid:[123]", startTicks: "400" },
    } as const;
    equal(sameProcessIdentity(linuxA, { ...linuxA, linux: { ...linuxA.linux } }), true);
    equal(
        sameProcessIdentity(linuxA, {
            ...linuxA,
            linux: { ...linuxA.linux, startTicks: "401" },
        }),
        false,
    );
    equal(
        sameProcessIdentity(linuxA, {
            ...linuxA,
            linux: { ...linuxA.linux, pidNamespace: "pid:[456]" },
        }),
        false,
    );
    equal(
        sameProcessIdentity(
            { platform: "darwin", startedAt: 1_000 },
            { platform: "darwin", startedAt: 1_001 },
        ),
        false,
    );
    equal(sameProcessIdentity(undefined, linuxA), false);
    equal(sameProcessIdentity(linuxA, undefined), false);
    notEqual(sameProcessIdentity(linuxA, { platform: "win32", startedAt: 1 }), true);
});

test("invalid PIDs have no process birth identity", async () => {
    for (const invalid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
        equal(await getProcessBirthIdentity(invalid), undefined, String(invalid));
    }
});
