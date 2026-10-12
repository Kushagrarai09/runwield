---
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "HIGH"
status: "in-progress"
createdAt: "2026-10-12"
---

# Complete the Bun toolchain migration

Carlos is dogfooding v0.12.0-rc.1 and requested phase 2: tooling, containers and replacement of direct `@std/` dependencies.
The RC is a Bun executable; the repository still requires Deno for several developer and delivery paths.
This work starts at `9d4bb0374` in an isolated checkout. Preserve the primary checkout, installed executable, live Sessions,
published RC and Stable channel. Publication is a draft PR only; merging and another release are not authorized.

## Inventory and sequence

1. Replace direct standard-library imports. The inventory contains 633 assertion imports, 401 path imports, 21 CLI
   parser imports, 12 front-matter imports, seven static JSONC imports plus one dynamic import, and two fake clocks.
   Prefer Node builtins for paths, URLs and assertions. Use maintained npm parsers and clocks with narrow adapters for
   existing caller contracts. Pin flag aliases, repeated values, literal `--no-*` flags, argument boundaries, YAML dates
   and malformed documents, JSONC trailing commas and rejection, and deterministic clock advancement.
2. Normalize package commands: `compile`, source startup, tests, Golden tests, CI, release/package commands, hooks and
   documentation. Preserve isolated HOME/database/temp handling, descendant cleanup, all source and Golden coverage,
   type/lint/format rules, dependency age and disabled install scripts. Replace Deno-based build identity inputs.
3. Migrate PR/release/docs workflows and remote Workspace container builds. Build reproducibly with Bun 1.4.3 and frozen
   root/docs lockfiles. Preserve package smoke tests, Stable/Candidate separation, immutable release recovery, WinGet pause,
   unprivileged container execution, durable `/data`, and restricted filesystem access. Deno permission flags cannot simply
   disappear without an equivalent enforced container boundary.
4. Remove obsolete root/docs Deno manifests after their consumers are migrated. Audit runtime selection, prototype
   tooling, source fixtures, generated bundles, container assertions, docs reconciliation and developer instructions.
   Historical documents and example projects may discuss Deno; they are not active toolchain requirements.

## Acceptance

- A clean environment without a Deno executable installs both frozen graphs, passes static/source/Golden gates, builds
  and packages the CLI, and runs the relocated CLI and remote Workspace container.
- Supported macOS/Linux/Windows qualification runs in cloud CI. Native Windows path, locking and cleanup coverage stays.
- Cross-runtime lock compatibility with released Deno binaries remains a separate compatibility check, not a prerequisite
  for the everyday Bun toolchain. Do not silently remove compatibility coverage while old releases are supported.
- Independent Standards, Spec and Tests reviews approve concrete changes. Focused regression tests must fail under a
  plausible broken implementation. Keep local disk bounded and retain compact cloud evidence.
- Draft PR description distinguishes implemented behavior, verified platforms and remaining limitations.

## Dependency sources

The Node assertion/path/URL APIs are the default replacements. Parser behavior is checked against the existing contracts
and the maintained upstream documentation for [yargs-parser](https://github.com/yargs/yargs-parser),
[js-yaml](https://github.com/nodeca/js-yaml), [jsonc-parser](https://github.com/microsoft/node-jsonc-parser), and
[Sinon fake timers](https://github.com/sinonjs/fake-timers). Existing locked parser versions are preferred to unrelated upgrades.

## Delivery checkpoint

The dependency replacement is committed as `77ec91f36`. Direct source/test imports now use Node builtins plus
js-yaml, jsonc-parser, yargs-parser and Sinon clocks. Commit `16af8b4a1` removes root @std aliases and the Deno Astro adapter,
adds default Bun commands and named compile compatibility, migrates prototype execution and the staged formatting hook,
and moves source/Golden/release qualification and metadata identity to Bun. Historical tag recovery keeps tagged Golden
qualification and uses commands already present in RC1.

Local evidence: 1,325 source/test entries type-check; lint and zero-seam gates pass. Focused parser, storage, model,
prototype, hook, build identity, release and docs tests pass. Fifteen intentional regressions are detected, and the real
compiler rejects an expected-build-identity mismatch before emitting an artifact. A relocated native macOS package passed
CLI onboarding/cancel, Plan entry, worker/WASM, image conversion, Workspace assets/auth and shutdown.

The remote Workspace and Plan Server bundlers now use Bun through `bun run workspace:remote:build`. A real compiler
contract test executes relocated bundles with SQLite after deleting their source tree. The full remote bundle passed
health/readiness, review-page rendering, CSS delivery and clean shutdown with a disposable database. Container execution
and its filesystem boundary are not yet qualified. The initial cloud run passed all Golden shards, six Unix source shards
and macOS/Linux/Windows x64 package checks; source shard 1 exposed a missing JSONC module in a copied fixture, fixed in
`ca52c5c2a`. Cloud qualification is rerunning on the repaired branch.

Remaining before completion: full cloud source/Golden/platform qualification; container build conversion;
legacy compiler and memory diagnostic retirement; historical docs deployment conversion; then removal of root/docs Deno
manifests. Bun has no equivalent per-process filesystem permissions. The container boundary decision is pending: enforced
non-root/read-only filesystem with `/data` writable, or retaining Deno until an OS sandbox is qualified. Do not describe
phase 2 as complete or publish another release while these remain.
