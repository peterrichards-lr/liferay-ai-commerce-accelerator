const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { withoutHashComments } = require('./fixtures/sourceComments.cjs');

/**
 * The tunnel must be switchable, and the accept measurement must be shaped.
 *
 * #1211 forwarded two of the three variables LDM's v2.26.0-pre.12 introduced
 * and missed LDM_DOCKER_TUNNEL, in a change whose whole subject was consuming
 * what LDM ships. And the accept capture it added emits a scalar, which cannot
 * answer the question it was added for: LDM's readiness loop issues ~1.5 docker
 * commands a second for the whole of Liferay's boot, so a total measures boot
 * duration rather than transport behaviour. See #1213, #1174.
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
const script = () => withoutHashComments(fs.readFileSync(SCRIPT, 'utf8'));

describe('the docker tunnel is switchable (#1213)', () => {
  it('is a dispatch input, off by default', () => {
    const input = workflow().on.workflow_dispatch.inputs.docker_tunnel;

    expect(input).toBeDefined();
    // Off by default on both sides: a run that does not ask for it is the
    // baseline the tunnel run is compared against.
    expect(input.default).toBe(false);
  });

  it('is exported into the step that runs the suite', () => {
    // The defect in #1211 exactly: an input nothing forwards is
    // indistinguishable, from the dispatch form, from one that works.
    const env = workflow().jobs['e2e-verification'].steps.find(
      (s) => s.name === 'Start LDM and run tests'
    ).env;

    expect(Object.keys(env)).toContain('LDM_DOCKER_TUNNEL');
    expect(String(env.LDM_DOCKER_TUNNEL)).toContain('docker_tunnel');
  });

  it('records in the artifact whether it was on', () => {
    // A run that silently ignored the flag must not read like one that had it.
    expect(script()).toMatch(/docker tunnel: /);
  });
});

describe('the accept measurement is a series, not a total (#1213)', () => {
  it('collects the lines rather than counting them at the source', () => {
    const source = script();

    // `grep -c` at the far end throws away the timestamps, and they are the
    // measurement. The count is derived locally instead.
    //
    // Asserted on the shape, not on the exact remote command text: the first
    // version of this case pinned `grep 'Accepted publickey'"` with the quote
    // immediately after, and adding `|| true` to fix a separate defect broke
    // it. A guard that fails when a neighbouring line is corrected is testing
    // the spelling rather than the property.
    // Scoped to the REMOTE command. Counting locally is correct and the
    // script does it on the next line; counting at the far end is what throws
    // the timestamps away. An unscoped negative matched that legitimate local
    // use and failed on correct code.
    // Anchored on the series assignment, not on `journalctl`: the privilege
    // probe uses journalctl too and comes first, so a non-greedy match from
    // there selected the wrong block and failed on correct code.
    const remote = source.match(/series=\$\(ssh[\s\S]*?2>\/dev\/null\)/);

    expect(remote).not.toBeNull();
    expect(remote[0]).toMatch(/\| grep 'Accepted publickey'/);
    expect(remote[0]).not.toMatch(/grep -c/);
  });

  it('buckets by ten seconds', () => {
    // substr($3, 1, 7) truncates HH:MM:SS to HH:MM:S, and the trailing "0"
    // makes each distinct value a ten-second window.
    expect(script()).toMatch(/substr\(\$3, 1, 7\) "0"/);
    expect(script()).toMatch(/uniq -c/);
  });

  it('still reports the total, and still explains a low one', () => {
    const source = script();

    // The shape is the new information; the guarantees #1211 established are
    // not replaced by it.
    expect(source).toMatch(/Accepted publickey: \$\{count\}/);
    expect(source).toMatch(/a LOW number is the good outcome/);
  });

  it('does not report zero matches as an unreadable journal', () => {
    // The first version of this capture did exactly that: `grep` exits 1 when
    // it matches nothing, the pipeline takes grep's status, and run
    // 36707123322 came back "unreadable; ssh exit status 1" from a journal it
    // had read fine. The conflation this capture exists to prevent, committed
    // inside it. Zero is a legitimate measurement - it is what the tunnel
    // should produce.
    expect(script()).toMatch(/grep 'Accepted publickey' \|\| true/);
  });

  it('asks both unit names, since the wrong one is silent', () => {
    // `journalctl -u <wrong-unit>` exits 0 with no output, which is
    // indistinguishable from a journal with nothing in it. ssh.service on
    // Debian, sshd.service on RHEL and Amazon Linux.
    expect(script()).toMatch(/journalctl -u ssh -u sshd/);
  });

  it('distinguishes an unreadable journal from an empty one', () => {
    // A user outside systemd-journal silently gets only its own journal, with
    // exit 0 and no output - identical in the artifact to a quiet node. The
    // probe records what was visible and which groups the user holds, so the
    // reader can tell which they are looking at.
    const source = script();

    expect(source).toMatch(/journal lines visible/);
    expect(source).toMatch(/id -nG/);
    expect(source).toMatch(/NOT that the node was quiet/);
  });

  it('says a quiet period prints no bucket rather than a zero', () => {
    // Found by running the pipeline against a synthetic journal: silence
    // produces absent buckets, not zero-valued ones, so a reader told to look
    // for "near zero" sees a gap in timestamps and may read it as lost data.
    // The artifact has to say which, since it cannot show what is not there.
    expect(script()).toMatch(/prints NO bucket rather than a zero/);
  });
});
