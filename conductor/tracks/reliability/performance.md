# Track: Workflow Performance Optimization

## Status

- **Current State**: Workflow is slow due to aggressive idle delays (2s), slow polling (5s), and low concurrency (2).
- **Target State**: Snappy, responsive workflow with minimal idle time and optimized batch processing.

## Research Findings

1.  **Queue Latency**: `QueueService._loopQueue` waits 2000ms when idle and 1000ms when at capacity.
2.  **Polling Delay**: `POLLING_DELAY_MS` is 5000ms, which is too high for fast-moving Liferay imports.
3.  **Batch Overhead**: `BatchProcessorService` adds 500ms between batches and 100ms between sequential items.
4.  **Concurrency Bottleneck**: `data-generation` queue is capped at 2 concurrent jobs.

## Implementation Tasks

### 1. Optimize Queue Service

- [x] Reduce `_loopQueue` delays in `queueService.cjs`:
  - `delay(1000)` -> `delay(100)`
  - `delay(2000)` -> `delay(200)`
- [x] Increase default concurrency for `data-generation` from 2 to 4.

### 2. Sharpen Liferay Polling

- [x] Update `utils/constants.cjs`:
  - `POLLING_DELAY_MS`: 5000 -> 2000
  - `ABS_MIN.BATCH_MIN_POLL_INTERVAL`: 2000 -> 1000
- [x] Update `liferayConfig.cjs`:
  - `batchDelay`: 500 -> 100

### 3. Streamline Sequential Processing

- [x] Update `BatchProcessorService.cjs`:
  - Reduce `delay(100)` in `processSequentially` to `delay(10)`.

### 4. Verification

- [ ] Run a standard generation workflow.
- [ ] Monitor logs for "Advancing workflow" speed.
- [ ] Ensure no "429 Too Many Requests" from Liferay due to faster polling.

## Definition of Done

- Total generation time for a standard dataset is reduced by at least 30%.
- No visible "stalls" in the UI where the bar doesn't move for > 5 seconds.
- System remains stable under increased concurrency.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_
