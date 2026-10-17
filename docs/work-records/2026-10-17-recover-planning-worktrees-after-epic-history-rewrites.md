---
kind: "work_record"
recordId: "62a4e02c-ea11-43ad-a637-110bb2470ef5"
status: "pending_verification"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "internal"
completionMode: "verified"
createdAt: "2026-10-17T17:51:39.009Z"
provenance:
    sourcePlans:
        - "f8e5ab69-b8ab-4879-8b44-bf8565a1593c"
---

# Recover planning worktrees after Epic history rewrites

## Summary

Fixed planning refresh to measure child-owned changes from the recorded base instead of a merge base. After an Epic history rewrite, preparation-only worktrees now rebuild on the new target, preserve saved planning edits, retain a recovery ref, and update the registry. Real implementation and conflicting edits remain protected. Recovery also protects ignored files, detects concurrent editor changes, and resumes interrupted journals automatically. Updated the Core PRD acceptance scenario.

Reported focused verification passed 120 tests across five files, with mutation checks confirming regression sensitivity. Preparing the already-recovered child 09 again left its HEAD and saved Plan bytes unchanged.

## Future Planning Notes

Use the recorded worktree base to distinguish child changes from rewritten upstream history. Changing only the implementation-change check is insufficient: merging old and rewritten histories can still create conflicts or retain duplicate history.
