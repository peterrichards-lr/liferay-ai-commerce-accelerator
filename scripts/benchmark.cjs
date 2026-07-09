#!/usr/bin/env node
'use strict';

/**
 * benchmark.cjs
 *
 * Performance benchmark gate for the AICA microservice.
 *
 * Runs an autocannon load test against the /api/v1/health endpoint
 * (no auth required — health probes bypass request signing).
 *
 * Exits 1 if any threshold is violated, making it suitable for use as
 * a manual gate before release or as part of the E2E verification suite.
 *
 * Usage:
 *   node scripts/benchmark.cjs [--url http://localhost:3001] [--duration 10]
 *
 * Prerequisites:
 *   The microservice must be running before executing this script.
 *   Start it with: node client-extensions/ai-commerce-accelerator-microservice/server.cjs
 */

const autocannon = require('autocannon');

// ─── Configuration ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : fallback;
};

const BASE_URL = getArg(
  '--url',
  process.env.MICROSERVICE_URL || 'http://localhost:3001'
);
const DURATION_SECS = parseInt(getArg('--duration', '10'), 10);
const CONNECTIONS = parseInt(getArg('--connections', '10'), 10);

// ─── Thresholds ────────────────────────────────────────────────────────────────

const THRESHOLDS = {
  minRequestsPerSec: 50, // Minimum sustained throughput
  maxLatencyP99Ms: 500, // p99 latency ceiling (ms)
  maxLatencyAvgMs: 100, // Average latency ceiling (ms)
  maxErrorRatePercent: 1, // Max acceptable error rate (%)
};

// ─── Run ───────────────────────────────────────────────────────────────────────

async function runBenchmark() {
  const targetUrl = `${BASE_URL}/api/v1/health`;

  console.log('\n📊 AICA Microservice — Performance Benchmark Gate');
  console.log('─'.repeat(55));
  console.log(`Target  : ${targetUrl}`);
  console.log(`Duration: ${DURATION_SECS}s  Connections: ${CONNECTIONS}`);
  console.log('─'.repeat(55));
  console.log('Running... (this will take a moment)\n');

  const result = await new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: targetUrl,
        connections: CONNECTIONS,
        duration: DURATION_SECS,
        timeout: 10,
        headers: {
          Accept: 'application/json',
        },
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      }
    );

    // Print a live progress bar
    autocannon.track(instance, { renderProgressBar: true });
  });

  // ─── Results ───────────────────────────────────────────────────────────────

  const reqsPerSec = result.requests.mean;
  const latencyAvgMs = result.latency.mean;
  const latencyP99Ms = result.latency.p99;
  const totalRequests = result.requests.total;
  const errors = result.errors;
  const errorRate = totalRequests > 0 ? (errors / totalRequests) * 100 : 0;

  console.log('\n📈 Results');
  console.log('─'.repeat(55));
  console.log(`Requests/sec (avg) : ${reqsPerSec.toFixed(1)}`);
  console.log(`Latency avg        : ${latencyAvgMs.toFixed(1)} ms`);
  console.log(`Latency p99        : ${latencyP99Ms} ms`);
  console.log(`Total requests     : ${totalRequests}`);
  console.log(`Errors             : ${errors} (${errorRate.toFixed(2)}%)`);
  console.log('─'.repeat(55));

  // ─── Threshold Checks ──────────────────────────────────────────────────────

  const violations = [];

  if (reqsPerSec < THRESHOLDS.minRequestsPerSec) {
    violations.push(
      `❌ Throughput too low: ${reqsPerSec.toFixed(1)} req/s (min: ${THRESHOLDS.minRequestsPerSec})`
    );
  } else {
    console.log(
      `✅ Throughput      : ${reqsPerSec.toFixed(1)} req/s ≥ ${THRESHOLDS.minRequestsPerSec}`
    );
  }

  if (latencyAvgMs > THRESHOLDS.maxLatencyAvgMs) {
    violations.push(
      `❌ Avg latency too high: ${latencyAvgMs.toFixed(1)} ms (max: ${THRESHOLDS.maxLatencyAvgMs} ms)`
    );
  } else {
    console.log(
      `✅ Avg latency     : ${latencyAvgMs.toFixed(1)} ms ≤ ${THRESHOLDS.maxLatencyAvgMs} ms`
    );
  }

  if (latencyP99Ms > THRESHOLDS.maxLatencyP99Ms) {
    violations.push(
      `❌ p99 latency too high: ${latencyP99Ms} ms (max: ${THRESHOLDS.maxLatencyP99Ms} ms)`
    );
  } else {
    console.log(
      `✅ p99 latency     : ${latencyP99Ms} ms ≤ ${THRESHOLDS.maxLatencyP99Ms} ms`
    );
  }

  if (errorRate > THRESHOLDS.maxErrorRatePercent) {
    violations.push(
      `❌ Error rate too high: ${errorRate.toFixed(2)}% (max: ${THRESHOLDS.maxErrorRatePercent}%)`
    );
  } else {
    console.log(
      `✅ Error rate      : ${errorRate.toFixed(2)}% ≤ ${THRESHOLDS.maxErrorRatePercent}%`
    );
  }

  console.log('─'.repeat(55));

  if (violations.length > 0) {
    console.error('\n🚨 Benchmark threshold violations detected:');
    violations.forEach((v) => console.error(`  ${v}`));
    console.error('\nPerformance gate FAILED.\n');
    process.exit(1);
  } else {
    console.log('\n✅ All thresholds passed. Performance gate OK.\n');
    process.exit(0);
  }
}

runBenchmark().catch((err) => {
  console.error(`\n💥 Benchmark failed to run: ${err.message}`);
  console.error('Is the microservice running? Start it with:');
  console.error(
    '  node client-extensions/ai-commerce-accelerator-microservice/server.cjs\n'
  );
  process.exit(1);
});
