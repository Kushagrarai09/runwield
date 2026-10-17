---
kind: "work_record"
recordId: "85f37a6b-6297-46f7-a17d-399d75f3f2f2"
status: "pending_verification"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "internal"
completionMode: "verified"
createdAt: "2026-10-17T17:51:07.369Z"
tickets:
    - url: "https://github.com/gandazgul/runwield/pull/315"
provenance:
    sourcePlans:
        - "59cd99ae-2682-4a76-8e79-047b2b4799e7"
---

# Project request recovery and regression coverage

## Summary

Applied request recovery to the shared Project link/relink form and all four maintenance operations. Pending requests show shared loaders and block duplicate submissions. Failed or interrupted requests restore controls, retain form values, and allow retry. Non-JSON HTTP errors show a fallback message. Directory confirmation remains intact, and the Workspace PRD retains the recovery requirement.

Replaced callback-only maintenance tests with native event dispatch and moved link/relink coverage to the shared island. The execution report records 32 passing focused tests, expected mutation-test failures, passing formatting and Workspace checks, and desktop/mobile browser checks with no browser errors.

## Future Planning Notes

Test browser handlers through native events so incorrect event bindings fail. Cover interrupted response bodies as well as rejected fetches; both can leave request controls stuck without recovery.
