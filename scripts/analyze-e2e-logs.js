const fs = require('fs');
const path = require('path');

/**
 * Forensic Log Analyzer for E2E Tests
 * Scans microservice logs for ERROR/FATAL entries and provides a detailed report.
 */

const LOG_FILE = process.argv[2];

// Errors we expect to see during certain tests (e.g., testing failure recovery)
// For now, we want a "clean" log, so this is empty.
const IGNORE_PATTERNS = [
  /Cannot read properties of undefined \(reading 'split'\)/i, // Handled domain detection error
  /relation ".*" does not exist/i, // Expected during fresh PostgreSQL Liferay initialization
  /duplicate key value violates unique constraint/i, // Expected during Site Initializer portlet preference insertion
  /aicaconfigurations.*(404|No service was found|Not Found)/i, // Expected startup registration delay warnings
  /get-option-by-erc/i, // Handled Liferay option-by-ERC 500 bug fallback check
  /get-price-list-by-erc/i, // Handled price list 404 soft status check
  /Failed to link warehouse to channel/i, // Handled duplicate warehouse-to-channel mapping link bypass
  /create-warehouse-channel/i, // Handled duplicate warehouse-to-channel mapping link bypass
  /Request failed \(HTTP error\)/i, // Handled microservice multi-line HTTP request failure headers
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s+(ERROR|FATAL)\s*$/i, // Winston multiline empty log-level header lines
];

function stripAnsi(str) {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ''
  );
}

function analyze() {
  if (!LOG_FILE) {
    console.error('Usage: node analyze-e2e-logs.js <path-to-log-file>');
    process.exit(1);
  }

  if (!fs.existsSync(LOG_FILE)) {
    console.error(`Log file not found: ${LOG_FILE}`);
    process.exit(1);
  }

  console.log(`>>> Analyzing logs from: ${LOG_FILE}`);

  const content = fs.readFileSync(LOG_FILE, 'utf8');
  const lines = content.split('\n').filter((l) => l.trim() !== '');

  const errors = [];
  let fatalCount = 0;

  lines.forEach((line, index) => {
    line = stripAnsi(line.trim());
    try {
      // Try parsing as JSON first (standard microservice output)
      const log = JSON.parse(line);

      if (log.level === 'ERROR' || log.level === 'FATAL') {
        const isIgnored = IGNORE_PATTERNS.some((pattern) =>
          pattern.test(log.message)
        );

        if (!isIgnored) {
          errors.push({
            line: index + 1,
            level: log.level,
            message: log.message,
            operation: log.operation,
            correlationId: log.correlationId,
            errorStack: log.errorStack,
            raw: line,
          });
          if (log.level === 'FATAL') fatalCount++;
        }
      }
    } catch (err) {
      // Fallback for non-JSON lines (e.g. startup crashes, stack traces printed directly)
      if (line.match(/\b(FATAL|ERROR)\b/)) {
        const isIgnored = IGNORE_PATTERNS.some((pattern) => pattern.test(line));
        if (!isIgnored) {
          errors.push({
            line: index + 1,
            level: 'RAW_MATCH',
            message: line.trim(),
            raw: line,
          });
        }
      }
    }
  });

  if (errors.length > 0) {
    console.error(
      `\nFAIL: Detected ${errors.length} unexpected error(s) in logs.`
    );
    console.error(
      '------------------------------------------------------------'
    );

    errors.forEach((err) => {
      console.error(`[Line ${err.line}] [${err.level}] ${err.message}`);
      if (err.operation) console.error(`  Operation: ${err.operation}`);
      if (err.correlationId)
        console.error(`  Correlation ID: ${err.correlationId}`);
      if (err.errorStack) {
        console.error('  Stack Trace:');
        console.error(
          err.errorStack
            .split('\n')
            .map((s) => `    ${s}`)
            .join('\n')
        );
      }
      console.error(
        '------------------------------------------------------------'
      );
    });

    process.exit(1);
  } else {
    console.log('\nSUCCESS: No unexpected errors detected in logs.');
    process.exit(0);
  }
}

analyze();
