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

Bun is the preferred target; Node + pnpm remains the fallback if compatibility evidence warrants it. No target-choice
clarification is needed to continue. Production cutover still requires the acceptance gates below: do not replace the
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

## Dependency and test-runner migration slice

Bun now has an exact `1.4.3` runtime pin, `package.json`, `bun.lock`, isolated installs, JSR npm aliases and the root
TypeScript alias configuration. Direct runtime packages retain versions from the existing Deno graph. The three Pi
transitive components (`chord`, `pi-codemode`, `pi-telemetry`) are explicitly kept at 1.0.0 to avoid pulling Pi 1.1
behavior into a runtime migration. Other transitive resolutions are recorded in Bun's own lockfile; the two managers'
lockfile formats are not interchangeable. Bun's package scripts force the selected Bun binary through its Node alias,
avoiding accidental use of an older globally installed Bun.

Install lifecycle scripts remain disabled. The release-age gate remains 86,400 seconds; the current eight Earendil
packages are explicitly exempt, matching the current graph covered by Deno's scope exception. New packages in that scope
must be added to the Bun exception list when the dependency graph changes. Runtime auto-install and implicit `.env`
loading are disabled. Deno retains automatic node_modules mode so existing fresh-checkout CI and release jobs keep
working. During this transition, run `bun install --frozen-lockfile` again before Bun checks after a Deno-managed
install.

`bun run test:bun` uses `scripts/run-bun-tests.ts`: one process and canonical disposable HOME, USERPROFILE, XDG, temp
and database paths per file, including files reusing a worker slot. Only a small operating-system environment allowlist
is inherited; provider keys and user database paths are not forwarded. The preload guard runs before test imports and
rejects direct unsandboxed `bun test`. Successful sandboxes are removed; failed sandboxes and per-file output/run
reports are retained. Per-file deadlines cover imports as well as tests; Bun's `--no-orphans` owns descendant cleanup
and a forced kill follows an ignored termination signal. `WLD_TEST_CONCURRENCY` and `WLD_TEST_FILE_TIMEOUT_MS` accept
positive integers.

This is an incremental test migration. The default Bun list is explicit in `scripts/bun-test-files.json`; it is not a
claim that all Deno tests run under Bun. Files may also be passed explicitly. Node-compatible `node:test` registration
lets the portable filesystem cases run under both runtimes. Runner-specific checks skip under Deno and execute under
Bun. TypeScript checks for migrated code use `tsconfig.bun.json`; Deno's full type checker, lint plugin, custom checks
and suite remain required until their replacements cover the complete tree. `bun run ci:deno` retains the existing
complete gate.

Verification includes clean frozen installation outside the checkout, direct dependency import-map version agreement,
real Pi/MCP/JSR/SQLite imports, retained Session-store tests, and real subprocess tests proving isolation, failure
handling and timeouts. The runner was subsequently qualified on Linux ARM64 as recorded below; Windows execution remains
pending.

References: [Bun configuration](https://bun.com/docs/runtime/bunfig),
[Bun lifecycle policy](https://bun.com/docs/pm/lifecycle), and
[JSR npm compatibility](https://jsr.io/docs/npm-compatibility).

Tooling verification on macOS ARM64: all eleven CI pre-test tasks passed (full source type check, Workspace type check
and build, docs, lint, submodules, skill sync and custom policies). Bun's two migrated test files passed, including
reading retained failure evidence, and the migrated TypeScript gate passed. Independent Standards, Spec and Tests
reviews approved with zero open issues after restoring Deno automatic installation and strengthening the failure
retention assertion. The full source suite is being exercised separately; the first sandboxed attempt could not bind
localhost HTTP fixtures, so the retry uses approved localhost access with the repository's isolated per-file runner.

## Process and environment utility migration

The next slice replaces the external `kill -0` subprocess and Deno hostname call with `node:process` signal-zero and
`node:os` hostname. Invalid or unqueryable PIDs retain the previous false result; foreign-host and unattributable locks
remain conservative. Real child-process tests follow a holder from live to exited without modifying owned lock
machinery.

`getHomeDir()` and `getCwd()` now use lazy Node-compatible environment/cwd access. Source resource paths use `node:path`
and `node:fs`; the existing Deno per-realm test detection remains during transition, with Bun/Node entrypoint detection
and Bun's preload guard providing the new runtime coverage. The process-global test lock retains its process identity,
filesystem exclusion, heartbeat, stale cleanup and synchronous exit cleanup using Node-compatible APIs. Existing lock
concurrency and heartbeat tests now run under both test runners. New environment tests verify post-import HOME/cwd
changes, source resource readability and rejection before an unsandboxed test entrypoint's body runs.

Foreground command spawning, remote Linux process-group termination and runtime packaging still require separate
migration. In particular, Node's asynchronous spawn-error delivery differs from current synchronous `Deno.Command`
callers; this cannot be changed by a mechanical rename without adjusting the callers and failure tests.

Process utility verification: five Bun test files and the migrated TypeScript gate passed. Deno passed the new liveness,
portable constants and lock tests plus existing constants, Plan doctor and worktree-registry tests. Full Deno type
checking, targeted lint, formatting and the zero-seam check passed. Independent Standards/Spec/Tests reviews approved
with zero open issues after making the HOME/cwd regression test use distinct directories. These utilities are verified
on macOS ARM64; Windows and Linux runtime execution remain qualification work.

## Portable Session manifest readers and recovery

Session Project/manifest reads, directory scans, canonical paths, fingerprints and recovery renames now use `node:fs`
and `node:path`. Missing-path handling checks `ENOENT`; invalid JSON and other filesystem errors retain their existing
propagation. All consumers of the exported readers were audited: external typed NotFound catches in the store apply to
its own Deno stat/remove calls, not the converted readers. Writer exclusion, lock acquisition and activation fencing
remain on the existing Deno implementation.

The unchanged directory-name encoder now has a small portable module, re-exported from its old location. The two
transcript domain types live with the Session-store contracts and are aliased from their previous JSDoc location. The
held-lock resource contract names only its existing release/close operations; this permits type-checking portable
storage without importing the complete Deno application. It does not add a lock factory or injection seam.

Real-filesystem cases cover canonical Project identity, transcript aliases, bounded directory names, missing paths,
invalid JSON, non-directory failures, broken symlinks, cache clone isolation, same-size/same-mtime atomic replacement,
recovery after deletion and preservation of damaged manifest bytes. Bun's selected type gate now covers the complete
storage module and its reachable domain types.

Broader regression evidence: the source run passed 446 files before an image-adapter cancellation assertion failed. That
file passed on an isolated rerun; the 131 skipped files plus two newly added files all passed in a separate run. The
intermittent cancellation failure is retained as qualification evidence, not silently counted as a clean full run. The
original log is `.ci-cache/bun-migration-suite.log`; rerun reports are in `.ci-cache/image-regression-report/` and
`.ci-cache/remaining-suite-report/`. None of these tests invokes a real image provider.

Storage verification: all six selected Bun files and their TypeScript gate passed; eight isolated Deno files covering
portable storage, Session store, owner coordination, reviews/rollover, root sessions and transcript projection passed.
Full Deno type checking, targeted lint, formatting and zero-seam checks passed. Standards, Spec and Tests review
approved after strengthening nested cache clone isolation and pinning legacy long-path encoding against same-basename
roots.

## Compiled storage qualification and activation evidence

The manifest storage assertions are shared between the isolated suite and `scripts/check-portable-json.ts`, alongside
the original atomic-write assertions. The qualification driver executes the same cases under Bun, Node and relocated
compiled executables. Initial ten-case runs passed from Bun/Node source, a relocated macOS ARM64 executable, and a Linux
ARM64 executable inside the existing cached Debian container with networking disabled and a read-only root filesystem.
Only a temporary sandbox was writable; no build-machine node_modules or source tree was mounted.

Activation-baseline and committed-transcript reads now use `node:fs`. Shared cases also check unchanged initial
evidence, changed bytes, missing segments, same-length digest mismatch, appended bytes and missing transcripts. They
preserve the existing idle/uninitialized, reconciliation-required and uncertain recovery distinctions. Actual
writer-lock acquisition still requires the Deno runtime. Windows native locks and complete application packaging remain
unqualified.

The expanded twelve-case driver passed from Node source and compiled executables on macOS ARM64 and Linux ARM64. The
activation baseline test also preserves byte length while changing content, so a length-only digest check cannot pass.
Independent Standards/Spec/Tests reviews approved after this strengthening. The Bun CLI itself remains unported: a
sandboxed `src/cli.ts --help` run stops at the entrypoint's `Deno.args` access. This is a concrete remaining startup
dependency, not a claim that storage qualification makes the application runnable under Bun.

All six migrated Bun test files also passed using the cached Bun 1.4.3 Linux ARM64 runtime in the network-disabled
container. Source and dependencies were mounted read-only; runner sandboxes and reports were isolated writable paths.
The report is `.ci-cache/linux-bun-runner/bun-report-9S56K5/run.json`. Final twelve-case compiled logs are
`.ci-cache/portable-storage-darwin.log` and `.ci-cache/portable-storage-linux.log`.

## Linux-owned process-group cleanup

`terminateOwnedLinuxGroup` now lives in a portable module, re-exported from `foreground-process.ts` for existing
callers. It uses Node-compatible `/proc` reads and process signals while retaining the real detached leader's
PID/completion contract. It checks group membership, ignores zombies, refuses to prove cleanup through permission-denied
`/proc`, and only sends forced group signals while the original leader is still alive. Foreground spawn APIs are
unchanged.

The existing real child/grandchild tests now use portable process creation and execute under Bun on Linux. They verify
graceful cleanup leaves an unrelated child running, and a SIGTERM-resistant group is killed only after its grace period.
The explicit Bun registry and type scope include this module and its tests. macOS skips these Linux-only cases.

Linux verification passed all seven registered Bun files (29 tests), including an additional real exited-leader case
that returns uncertainty and leaves its surviving descendant unsignaled. The forced-cleanup test observes both
SIGTERM-resistant processes alive during the grace window before confirming their eventual exit. Report:
`.ci-cache/linux-bun-runner/bun-report-AxPtbP/run.json`. Deno targeted type/lint and zero-seam checks passed; all three
review axes approved after strengthening the grace-period observation.
