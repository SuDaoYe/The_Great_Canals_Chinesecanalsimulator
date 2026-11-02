Reviewed current T01 snapshot (17:58) in `src/core` plus determinism tests/fixtures; **model: deepseek-flash/high** (economical G reviewer replacement). No edits made.

**Verdict: PASS for T01 as scoped, with limitations.**
- `npm test -- --pool=threads`: 45/45 pass. `npm run typecheck`: pass. Plain `npm test` is blocked in this sandbox by Vitest forks `spawn EPERM` (environment, not a code failure).
- Scope/flip risk: `src/core/reducer.ts:29` rejects every nonempty `pendingEvents`; `tests/core/determinism.test.ts:77-84` locks that behavior, so the preflight’s synthetic `effectiveTick=4` observation cannot occur. `T01.md` assigns scheduling to later work; if preflight #3 is enforced as T01, this is a blocker.
- Minor: `src/core/tick.ts:11` returns mutable `events: []` on the ending path, while normal ticks return frozen events. State and hash are unaffected.
- Test gap: `tests/core/determinism.test.ts:130` checks `inTransit: []` against an already-empty `inTransit`, so queue-hash sensitivity is vacuous. No populated-`inTransit`, `revision`, populated-`ending`, or cross-process hash test; code inspection shows those fields are serialized.
