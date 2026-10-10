---
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "HIGH"
affectedPaths:
    - "deno.json"
    - "package.json"
    - "scripts/run-tests.js"
    - "scripts/compile.js"
    - "src/shared/private-json-file.ts"
    - "src/shared/session/file-session-storage.ts"
    - "src/shared/session/file-session-control.ts"
    - "src/constants.js"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-10-10"
status: "draft"
---

# Migrate RunWield's runtime without weakening storage or isolation

## Context and recovered decisions

Carlos requested continued migration work while away. The October 10 runtime discussion selected a Bun proof of concept
before a production decision. His subsequent clarification makes the complete Bun toolchain (including package
management) the preferred migration target, with Node plus pnpm as a fallback if compatibility evidence warrants it. Bun
plus pnpm is not the selected combination. A future Core/Workspace repository or licensing split is a separate change.

The existing feasibility experiment is in branch `codex/bun-poc`, based on `28cc9d28f`, at
`/Users/gandazgul/.codex/worktrees/bun-poc/runwield`. Its uncommitted report is `docs/research/bun-runtime-poc.md`; its
executable source and results are ignored under `prototypes/bun-runtime/`. Preserve those files before archiving that
worktree. This continuation does not modify them.

The POC report records ten passing dependency/OS probes on macOS ARM64 and Linux ARM64, macOS PTY checks, and Deno/Bun
POSIX-lock interoperability. It used Bun **1.4.3**; the installed global 1.3.12 lacked the required `node:sqlite`
import. Photon's WASM and Pi's image worker required explicit executable embedding. This is evidence for feasibility,
not qualification of the full application or a final runtime decision.

The source discussion proposed four stages: prove difficult runtime features; move dependencies/tooling; migrate
production and tests subsystem by subsystem; qualify and switch distribution. This document makes those stages concrete.

## Objective and scope

Preserve current Session identity, files, recovery, writer exclusion, CLI/TUI behavior and Workspace journeys while
replacing Deno-specific runtime dependencies. Follow [ADR-015](../adr/015-file-authoritative-session-bundles.md) and the
Core [execution, validation and recovery requirements](../prd/runwield-core-prd.md#execution-validation-and-recovery).
No current PRD requirement is added or removed by the first portable storage slice.

The fundamental decision still open is whether to adopt Bun for production after feasibility qualification or retain
Node + pnpm as the fallback. Portable `node:` filesystem work can proceed under either choice. Do not replace the
default runtime, installer, CI or package manager based solely on the POC recommendation.

## Implementation sequence and acceptance gates

1. **Portable storage foundation (this continuation).** Move private directory creation and atomic JSON persistence out
   of `file-session-storage.ts` into `src/shared/private-json-file.ts`, using `node:fs`, `node:path` and `node:crypto`.
   Preserve current exports/callers, 0700 directories, 0600 replacement files, exclusive temporary creation, complete
   writes, file fsync, atomic rename, best-effort parent fsync, and existing failure propagation. Preserve current
   temporary-file retention after a failed write/rename. Keep Session locks and file formats unchanged. Test real files
   under Deno, Bun and Node, then the real Session store under Deno. This slice does not make the Session store fully
   runtime-portable: readers, locks, paths and the wider dependency graph still depend on Deno.
2. **Dependency and tooling migration.** Pin the qualified Bun runtime and convert the full import map and locked
   dependencies, including package subpath aliases and vendored Plannotator paths. Establish the Bun
   manifest/lock/install configuration (or pnpm if Node wins). Preserve the 24-hour minimum dependency age, its existing
   Earendil exception, and install-script trust policy. Keep type checking separate from TS execution. Map formatter,
   linter, custom lint plugins, skill sync, injection-seam and documentation checks before replacing their Deno tasks.
   Accept when clean installs reproduce the locked graph and all existing checks retain coverage.
3. **Isolated tests and process/environment utilities.** Preserve one process and disposable HOME, temporary directory,
   XDG paths and Mnemoteca database per test file. Preserve `getHomeDir()`/`getCwd()` as lazy accessors and fail-closed
   protections against direct unsandboxed suites. Port process spawn, streams, cancellation and descendant termination
   with real subprocesses. Keep zero injection seams for owned machinery. Accept when parallel runs do not share mutable
   state and cancellation reaps descendants without falsely completing recovery.
4. **Storage, locks and workflow execution.** Move readers and writers in coherent slices; audit both `ENOENT` and Deno
   exception consumers during mixed-runtime development. Preserve durable-write ordering, generation/fence validation,
   snapshot-safe stale-lock retirement, crash release and cross-process exclusion. POSIX FFI proof is not a Windows
   solution: qualify Windows native locks and error semantics before replacing the production lock implementation.
   Accept against real Session, Plan, worktree, recovery and cross-runtime contention cases.
5. **CLI/TUI, integrations and Workspace.** Exercise real CLI startup, provider streaming/cancellation, MCP stdio/HTTP,
   ACP, SSH, terminal input/resize/restoration and the golden TUI portfolio. Build the full Astro/React Workspace and
   validate browser flows, assets, SSE and reconnect. The POC's import checks and small HTTP server do not cover these.
6. **Distribution switch.** Embed Photon WASM, the image worker, prompts, skills, fonts and Workspace assets explicitly.
   Run relocated executables without build-machine `node_modules` on all supported OS/architecture targets. Compare
   full-app startup, memory, binary size, and cold/warm worktree installs. Only then change default tasks, CI,
   installers and contributor documentation and remove Deno tooling. No releases or merges are authorized by this
   continuation.

## Verification for the first slice

- `deno run -A scripts/run-tests.js --isolated src/shared/private-json-file.test.ts` (never direct `deno test`).
- Through the same isolated runner: `file-session-store.test.js`, `file-session-store-owner.test.ts`,
  `file-session-last-plan-review.test.ts` and `file-session-plan-review-rollover.test.ts` in `src/shared/session/`.
- Bun 1.4.3 and Node: run `scripts/check-portable-json.ts`. It invokes the same real-filesystem assertions as the Deno
  test and creates/removes its own temporary directories. It does not open user state.
- Format, lint, type and zero-seam checks; independent Standards, Spec and Tests review.

The filesystem cases assert exact Unicode/JSON bytes, private modes on POSIX, preservation of an old open descriptor
across replacement, unchanged data after serialization failure and surfaced filesystem failures. Tests cannot prove
power-loss durability; the required fsync ordering is also reviewed directly. Windows is unqualified until run there.

## Recovered checkout state and remaining risks

At recovery, main was clean at `58b6ba176`. The migration conversation was idle and its only repository-visible work was
the Bun POC. Separate TypeScript-conversion branches/worktrees exist and are left alone. This continuation uses an
independent local clone based on that main commit, branch `codex/runtime-portable-foundation-oct10`. Process enumeration
was prohibited by the execution sandbox; app-reported idleness does not prove there are no unrelated background jobs.

A text inventory after the first slice found 1,888 `Deno.*` references in 236 non-test-named source files and 523 in 45
non-test-named script files (excluding node_modules and generated .astro directories). These counts include comments and
support fixtures, and are sizing evidence rather than a semantic migration checklist. The runtime replacement remains a
substantial staged project.

No production runtime switch, lock replacement, package-manager switch, release publication or study cohort is part of
this first slice. The POC's Windows/x64 gaps, full application qualification and production cutover remain open.

## First-slice delivery evidence (2026-10-10)

Implemented the portable writer and wired the existing Session storage exports to it. No tests fake the filesystem or
replace owned storage machinery.

- Deno 2.9.7: **40 tests passed** across the five isolated files above (29 Session store, 2 owner, 2 last-plan-review, 1
  plan-review-rollover, 6 portable filesystem). No failures or skips. Run summary and JUnit XML are retained locally
  under `.ci-cache/tests-report/`; the run took 5.34 seconds.
- Bun **1.4.3**: all six shared filesystem cases passed from source.
- Node **26.10.0**: all six shared filesystem cases passed from source. This is fallback compatibility evidence, not a
  claim of qualification against a Node LTS support policy.
- Bun 1.4.3 compiled `scripts/check-portable-json.ts` into a standalone executable. A copy in an unrelated disposable
  directory passed all six cases with a minimal environment and temporary HOME/XDG/database paths. The compiled code
  uses only bundled code and `node:` builtins. This qualifies this storage module on macOS ARM64, not the entire CLI.
- Targeted Deno type and lint checks passed for all five code files. `deno task seams:check` retained the zero-seam
  baseline. Formatting and `git diff --check` passed.
- Independent Review-skill Standards, Spec and Tests passes approved all six original changed files with zero issues and
  zero advisories. Durability ordering was reviewed directly; power-loss and Windows execution remain untested.

The full application CI suite, Windows/x64 qualification and complete Bun application build are still pending future
migration slices. This commit is local only; no branch was pushed, PR opened, release published or merge performed.
