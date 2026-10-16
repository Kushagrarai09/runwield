---
kind: "work_record"
recordId: "60dc16d7-b2a5-43d0-a3a6-9b0883708c69"
status: "pending_verification"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-10-16T03:41:18.220Z"
provenance:
    sourcePlans:
        - "14000720-5bc1-4921-97ea-eaea9faf18a1"
---

# Edit-to-suggest in Code Review

## Summary

Implemented experimental, default-off edit-to-suggest in standalone and Workspace Code Review. All-files edits become
suggestion annotations in repair feedback without writing project files; Guided Review remains unchanged. File reads now
use the execution worktree and the shared merge-base comparison. Added the code-only Display setting and Core PRD
requirement. Focused tests passed (77 total), and headed-browser checks confirmed suggestion handoff, comment retention
after Discard, and unchanged project files.

## Deferred Work

Resolve the first-line selection action overlapping the edit toolbar. Investigate the React invalid-hook warning emitted
by the passing PWA asset test.

## Future Planning Notes

Keep Pierre compatible with pinned Plannotator (1.3.6 for this implementation). Workspace review checkout resolution
depends on same-origin referrer context; preserve the document policy and referrer fields through service-worker
requests.
