---
status: accepted
---

# 000 - Initial Technology Stack

## Context

RunWield is designed to be an opinionated, plan-by-default coding harness that operates directly in the developer's
terminal. To ensure high maintainability, extreme execution speed, and an iteration cycle that feels instantaneous, the
foundational technology stack must be chosen carefully.

We need an environment that allows for rapid scripting without the overhead of heavy compilation pipelines, while still
maintaining strict type safety and leveraging modern, robust foundations for agentic AI interactions.

## Decision

We have selected the following foundational stack for RunWield:

1. **Release runtime: Bun 1.4.3, with Deno retained for compatibility checks**
    - **Why:** The Bun migration provides standalone executables with embedded Workspace and agent assets. Release
      builds use the pinned `.bun-version` and frozen root and docs dependency graphs, and verify the executing runtime
      as well as the release version and build identity. The five published platforms retain their canonical archive
      names and metadata. Deno source and Golden gates remain, alongside native Windows ZIP and Homebrew checks; the
      Candidate channel must pass these gates before publication. See [Releasing](../releasing.md).

2. **Language: Deno-native JavaScript/TypeScript mix**
    - **Why:** Superseded by [ADR-013](013-deno-native-typescript-ratchet.md). Existing JavaScript with JSDoc remains
      valid, but new production source under `src/` is ratcheted toward native TypeScript (`.ts`/`.tsx`) while preserving
      direct Deno execution and avoiding a TypeScript emit pipeline.

3. **Agent Foundation: `pi-mono` Ecosystem**
    - **Why:** Instead of building an LLM orchestration layer from scratch, RunWield will heavily leverage
      `@mariozechner/pi-coding-agent`, `pi-tui`, and related packages from the `pi-mono` ecosystem. These packages
      provide the core state machines, tool-calling wrappers, and terminal UI components needed to build a sophisticated
      agent workflow, allowing RunWield to focus strictly on the opinionated DAG execution and architectural routing.

## Consequences

### Positive

- **Standalone Distribution:** Users run compiled Bun executables without installing a JavaScript runtime. Development
  source remains directly executable under Bun and Deno.
- **Repeatable Tooling:** Bun builds and checks use the pinned runtime and frozen dependencies. Deno retains its source
  and Golden validation lane; tests in either runtime use the repository's isolated runners.
- **Agent Synergy:** Using `pi-mono` allows RunWield to inherit battle-tested LLM abstractions and focus purely on the
  "Gatekeeper" and planning logic.
- **Type Safety without Friction:** Deno-native checking provides a safety net without a separate runtime compilation
  tax; see ADR-013 for the current language ratchet.

### Negative

- **Two Runtime Lanes:** Retaining Deno compatibility requires checks for both runtimes. Their generated dependency
  directories must stay in separate checkouts to avoid package-manager metadata conflicts.
- **JSDoc Verbosity:** Writing complex generic types in JSDoc can occasionally be more verbose and visually noisy
  compared to native TypeScript syntax.
