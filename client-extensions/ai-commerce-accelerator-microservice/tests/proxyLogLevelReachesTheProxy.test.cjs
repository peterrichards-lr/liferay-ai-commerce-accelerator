const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { withoutHashComments } = require('./fixtures/sourceComments.cjs');

/**
 * The log level we choose has to reach the container.
 *
 * LDM shipped LDM_PROXY_LOG_LEVEL and LDM_PROXY_LOG_FORMAT (their #2022). On
 * our side the name appeared only in a comment, so setting the variable on a
 * dispatch would have left it on the runner - and the artifact would have come
 * back with an empty proxy log, reading as their switch having failed rather
 * than as ours never having passed it on.
 *
 * That shape has been avoided twice this week by noticing it in advance. See
 * #1211, and #1149 for what the level is for.
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKFLOW = path.join(
  ROOT,
  '.github',
  'workflows',
  'e2e-verification.yml'
);
const SCRIPT = path.join(ROOT, 'scripts', 'run-e2e-ldm.sh');

const workflow = () => YAML.parse(fs.readFileSync(WORKFLOW, 'utf8'));

const runStep = () => {
  const job = workflow().jobs['e2e-verification'];
  const step = job.steps.find((s) => s.name === 'Start LDM and run tests');
  if (!step) throw new Error('the step that runs the E2E has been renamed');
  return step;
};

describe('the proxy log level reaches the proxy (#1211)', () => {
  it('is offered as a dispatch input, defaulting to Traefik own default', () => {
    const inputs = workflow().on.workflow_dispatch.inputs;

    expect(inputs.proxy_log_level).toBeDefined();
    // Defaulting to anything else would change every scheduled run's log
    // volume as a side effect of making the level reachable.
    expect(inputs.proxy_log_level.default).toBe('ERROR');
    expect(inputs.proxy_log_level.options).toContain('DEBUG');
    expect(inputs.proxy_log_format.default).toBe('common');
    expect(inputs.proxy_log_format.options).toContain('json');
  });

  it('is exported into the step that runs the suite, not merely accepted', () => {
    // The whole defect: an input that nothing passes on is indistinguishable,
    // from the dispatch form, from one that works.
    const env = runStep().env;

    expect(Object.keys(env)).toContain('LDM_PROXY_LOG_LEVEL');
    expect(Object.keys(env)).toContain('LDM_PROXY_LOG_FORMAT');
    expect(String(env.LDM_PROXY_LOG_LEVEL)).toContain('proxy_log_level');
    expect(String(env.LDM_PROXY_LOG_FORMAT)).toContain('proxy_log_format');
  });

  it('selects notable lines in both log formats', () => {
    // `common` writes ` ERR `; `json` writes `"level":"error"`. A selector for
    // one finds nothing in the other, so asking LDM for json - which is the
    // better format, since it removes the ANSI escapes at source - would have
    // produced the empty section the capture exists to prevent.
    const source = withoutHashComments(fs.readFileSync(SCRIPT, 'utf8'));
    // To `|| true)`, not to the first `)` - which sits inside `(ERR|WRN)` and
    // truncated the match before the half this case is about.
    const selector = source.match(/proxy_notable=[\s\S]*?\|\| true\)/);

    expect(selector).not.toBeNull();
    expect(selector[0]).toMatch(/ERR\|WRN/);
    expect(selector[0]).toMatch(/level.*error\|warn/);
  });

  it('captures the SSH accept count, with its meaning stated', () => {
    const source = withoutHashComments(fs.readFileSync(SCRIPT, 'utf8'));

    expect(source).toContain('capture_ssh_accept_count');
    // Called, not merely defined - the defect family this repository keeps
    // meeting is a capture that exists and never runs.
    expect(source).toMatch(/capture_ssh_accept_count \|\| true/);
    // A low number is the good outcome and reads like a broken capture, so the
    // artifact has to say which. Asserting the explanation is in the OUTPUT,
    // not in a comment - hence the stripper above.
    expect(source).toContain('Accepted publickey');
    expect(source).toMatch(/a LOW number is the good outcome/);
  });
});
