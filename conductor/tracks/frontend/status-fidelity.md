# Track: Workflow Status Synchronization & UI Fidelity

## Status

- **Current State**: Frontend eagerly marks entities as "Done" and shows 100% progress as soon as batch counters reach the target, leading to drift before the microservice sends the official `STEP_COMPLETED` message.
- **Target State**: Frontend respects the server-driven `isDone` flag. Visual feedback reflects the transition between "Batch Complete" and "Step Verified".

## Research Findings

1.  **Eager Logic**: `MiniProgressItem.jsx` uses `(completed >= total)` to show the "Done" badge.
2.  **Weighted Progress**: `progressSelectors.js` uses `(completed / total)` to calculate overall progress, which reaches 100% before the server marks the step as `isDone`.
3.  **Verification Gap**: The microservice performs verification (e.g., `handleBatchCallback`) after the batch reaches 100%. The UI currently ignores this gap.

## Implementation Tasks

### 1. Update Frontend State Logic

- [x] Update `progressReducer.js` to ensure `isDone` is the primary indicator of step finality.
- [x] Add a `SET_STEP_PROCESSING` action or similar to reflect the verification phase. (Note: Handled via `isVerifying` derived state in UI)

### 2. Refine Progress Monitor UI

- [x] Update `MiniProgressItem` in `ProgressMonitor.jsx`:
  - Remove `(completed >= total)` from the `isDone` calculation.
  - Add a "Processing..." or "Verifying..." state when `completed === total` but `isDone` is false.
  - Ensure the "Done" badge only appears when `explicitIsDone` or `workflowStatus === 'completed'`.

### 3. Adjust Progress Selectors

- [x] Update `getTotalProgress` in `progressSelectors.js` to cap progress at 95% (or similar) until `isDone` is true, or use a more sophisticated weighted average that favors the `isDone` flag. (Note: Capped at 99%)

### 4. Verification

- [ ] Simulate a slow verification phase in the microservice (e.g., add a delay in `handleBatchCallback`).
- [ ] Verify the UI shows "Processing/Verifying" after the bar reaches 100% and before the "Done" badge appears.
- [ ] Ensure the overall progress doesn't jump to 100% prematurely.

## Definition of Done

- The "Done" badge for an entity only appears AFTER the `STEP_COMPLETED` WebSocket message is received.
- The overall "Workflow Status" header only shows `COMPLETED` when the session is actually finished.
- UI provides clear feedback during the gap between batch completion and step verification.
