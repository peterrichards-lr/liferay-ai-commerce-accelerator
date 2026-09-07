/**
 * Turns ajv errors into a correction the model can act on.
 *
 * A generation run used to die on the first malformed response: the model
 * returned valid JSON of the wrong shape - the whole product body nested inside
 * `description`, which is a locale-to-string map - and the session ended. There
 * were five product calls in that run, and any one of them failing lost the
 * work already done. See #633.
 *
 * Retrying with the same prompt would just be a slower failure, so the errors
 * have to come back with it. Raw ajv output is poor material for that: fifteen
 * entries all reading "must be string" say where the shape was wrong but not
 * what was expected instead. These are grouped by path and phrased as
 * instructions.
 */

// Enough to correct a shape, few enough to leave the original prompt dominant.
// A model given forty corrections tends to fixate on them and drop the rest of
// the brief.
const MAX_REPORTED = 8;

function describe(error) {
  const path = error.instancePath || '(root)';
  const keyword = error.keyword;

  if (keyword === 'additionalProperties') {
    return `${path}: remove the unexpected property "${error.params?.additionalProperty}"`;
  }

  if (keyword === 'required') {
    return `${path}: the required property "${error.params?.missingProperty}" is missing`;
  }

  if (keyword === 'type') {
    return `${path}: must be ${error.params?.type}`;
  }

  if (keyword === 'enum') {
    const allowed = (error.params?.allowedValues || []).join(', ');
    return `${path}: must be one of ${allowed}`;
  }

  return `${path}: ${error.message}`;
}

/**
 * The corrective text, or an empty string when there is nothing useful to say.
 *
 * Deduplicated by path so a repeated fault across fifty array elements counts
 * once - otherwise a single structural mistake fills the whole budget and hides
 * every other problem.
 */
function validationFeedback(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return '';
  }

  const seen = new Set();
  const lines = [];

  for (const error of errors) {
    // Collapse array indices: /products/0/description and /products/7/description
    // are the same mistake made twice.
    const shape = String(error?.instancePath || '').replace(/\/\d+/g, '/*');
    const key = `${shape}:${error?.keyword}:${
      error?.params?.additionalProperty || error?.params?.missingProperty || ''
    }`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    lines.push(describe(error));

    if (lines.length === MAX_REPORTED) {
      break;
    }
  }

  const more =
    errors.length > lines.length
      ? `\n(and ${errors.length - lines.length} further errors of the same kinds)`
      : '';

  return (
    'YOUR PREVIOUS RESPONSE WAS REJECTED. It was valid JSON but did not match ' +
    'the required schema. Correct exactly these problems and return the whole ' +
    'response again, keeping everything else the same:\n\n' +
    lines.map((line) => `- ${line}`).join('\n') +
    more +
    '\n\nPay particular attention to which properties are objects keyed by ' +
    'language code and which are plain values: nesting a whole object inside a ' +
    'field that expects a string is the most common cause of this rejection.'
  );
}

module.exports = { MAX_REPORTED, validationFeedback };
