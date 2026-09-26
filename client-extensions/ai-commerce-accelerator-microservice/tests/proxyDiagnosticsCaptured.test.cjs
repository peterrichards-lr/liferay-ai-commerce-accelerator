const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * The proxy capture must actually capture the proxy.
 *
 * #1149 stood open across four runs on inference alone, and the analysis
 * written on it described code that had since been replaced. Nothing in the
 * E2E script captured the proxy - not a router, not a label, not a network -
 * so every explanation for its 404 was reasoning about the outside of a box
 * nobody had opened. See #1168.
 *
 * A capture that silently produces nothing is this repository's recurring
 * defect: `logs/e2e-microservice.log` was uploaded empty on every run for
 * months. So these cases run the real function with `docker` and `curl`
 * stubbed, and assert what lands on disk rather than that the code exists.
 */
const SCRIPT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'run-e2e-ldm.sh'
);
const lines = fs.readFileSync(SCRIPT, 'utf8').split('\n');

function functionSource(name) {
  const start = lines.findIndex((l) => l.startsWith(`${name}() {`));
  if (start === -1) throw new Error(`${name} is gone from the script`);
  const end = lines.indexOf('}', start);
  return lines.slice(start, end + 1).join('\n');
}

// A node with a proxy, Liferay, and a microservice whose labels are present
// but whose network is not the proxy's - the shape that 404s while looking
// correct from either side alone.
function stubs(dir, { proxyPresent = true, dockerAlive = true } = {}) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });

  fs.writeFileSync(
    path.join(bin, 'docker'),
    `#!/bin/bash
${dockerAlive ? '' : 'exit 1'}
case "$1" in
  ps)
    ${proxyPresent ? 'echo "liferay-proxy-global"' : ''}
    echo "aica-e2e"
    echo "aica-e2e-ai-commerce-accelerator-microservice"
    ;;
  port) echo "80/tcp -> 0.0.0.0:80" ;;
  inspect)
    if [[ "$*" == *Config.Cmd* ]]; then
      echo '["--providers.docker=true","--api.insecure=true"]'
    elif [[ "$*" == *networks:* ]]; then
      # The combined template: the networks line, then every label. The
      # microservice carries correct labels on a network the proxy is not on,
      # which is the shape that 404s while looking right from either side.
      if [[ "$*" == *microservice* ]]; then
        echo "  networks: aica-e2e_default "
        echo "  traefik.enable=true"
        echo "  traefik.http.routers.ms.rule=Host(ai-commerce-accelerator-microservice.aica-e2e.demo)"
      elif [[ "$*" == *liferay-proxy* ]]; then
        echo "  networks: liferay-proxy-global_default "
      else
        echo "  networks: liferay-proxy-global_default "
        echo "  traefik.enable=true"
        echo "  traefik.http.routers.liferay.rule=Host(aica-e2e.demo)"
      fi
    elif [[ "$*" == *NetworkSettings.Networks* ]]; then
      echo "liferay-proxy-global_default"
    fi ;;
esac
exit 0
`,
    { mode: 0o755 }
  );

  // Liferay answers, the microservice subdomain gets Traefik's bare 404 - the
  // control and the case, which is the whole point of probing both.
  fs.writeFileSync(
    path.join(bin, 'curl'),
    `#!/bin/bash
target="\${@: -1}"
if [[ "$*" == *"-o /dev/null"* ]]; then
  if [[ "$target" == *microservice* ]]; then echo "404"; else echo "200"; fi
else
  if [[ "$target" == *microservice* ]]; then echo "404 page not found"
  else echo "<html>Liferay</html>"; fi
fi
exit 0
`,
    { mode: 0o755 }
  );

  return bin;
}

function runCapture(dir, opts = {}) {
  const bin = stubs(dir, opts);
  const harness = path.join(dir, 'capture.sh');
  fs.writeFileSync(
    harness,
    [
      'set -e',
      'TARGET_HOST=aica-e2e.demo',
      // Both, because the capture delegates to probe_host. Extracting only
      // the caller would leave the harness with a command-not-found and a
      // capture that produced nothing - the failure this file exists to catch.
      functionSource('probe_host'),
      functionSource('capture_proxy_diagnostics'),
      'capture_proxy_diagnostics pre-tests',
    ].join('\n')
  );

  // The capture reads client-extensions/*/LCP.json relative to the working
  // directory, and deliberately carries both naming conventions: the real
  // repository has a hyphenated id for the microservice and stripped ids for
  // the other two, which is what the first version got wrong (#1171).
  for (const [name, id] of [
    [
      'ai-commerce-accelerator-microservice',
      'ai-commerce-accelerator-microservice',
    ],
    ['ai-commerce-accelerator-frontend', 'aicommerceacceleratorfrontend'],
  ]) {
    const cxDir = path.join(dir, 'client-extensions', name);
    fs.mkdirSync(cxDir, { recursive: true });
    fs.writeFileSync(
      path.join(cxDir, 'LCP.json'),
      JSON.stringify({ id, kind: 'Deployment' }, null, 2)
    );
  }

  const result = spawnSync('bash', [harness], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });

  const file = path.join(dir, 'logs/e2e-proxy-routing-pre-tests.txt');
  return {
    status: result.status,
    stderr: result.stderr,
    facts: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null,
  };
}

function sandbox(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-proxy-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('proxy routing diagnostics (#1168)', () => {
  test('the artifact is written and names the proxy', () => {
    sandbox((dir) => {
      const { facts, status } = runCapture(dir);
      expect(status).toBe(0);
      // The defect class: a file that exists and says nothing.
      expect(facts).toBeTruthy();
      expect(facts.length).toBeGreaterThan(200);
      expect(facts).toContain('liferay-proxy-global');
      expect(facts).toContain('aica-e2e.demo');
    });
  });

  test('it records whether the proxy API is enabled', () => {
    sandbox((dir) => {
      const { facts } = runCapture(dir);
      // A missing routers dump means one of two things; the command says which.
      expect(facts).toContain('--api.insecure=true');
      expect(facts).toContain('--providers.docker=true');
    });
  });

  test('it records each container traefik labels and its networks', () => {
    sandbox((dir) => {
      const { facts } = runCapture(dir);
      expect(facts).toContain('traefik.http.routers');
      expect(facts).toMatch(/networks:/);
      // Correct labels on the wrong network 404s exactly like a missing
      // route, so both have to be readable from one artifact.
      expect(facts).toContain('aica-e2e_default');
      expect(facts).toContain('liferay-proxy-global_default');
    });
  });

  test('it probes a host that works alongside the one that does not', () => {
    sandbox((dir) => {
      const { facts } = runCapture(dir);
      // Without the control, a 404 is a fact about one host and nothing else.
      expect(facts).toMatch(
        /liferay \(the control\) -> https:\/\/aica-e2e\.demo\//
      );
      expect(facts).toMatch(
        /ai-commerce-accelerator-microservice -> https:\/\/ai-commerce-accelerator-microservice\.aica-e2e\.demo\//
      );
      expect(facts).toMatch(/status: 200/);
      expect(facts).toMatch(/status: 404/);
      // Traefik's body, not Liferay's - the distinction the whole issue turns on.
      expect(facts).toContain('404 page not found');
    });
  });

  test('probe hostnames come from the LCP.json id, not from the directory', () => {
    sandbox((dir) => {
      const { facts } = runCapture(dir);
      // The regression this file was extended for. LDM builds the Traefik
      // router from the id, and this repository carries both conventions:
      // the frontend's id is stripped, the microservice's is hyphenated.
      // Writing the directory name out returned a real 404 for a reason
      // inside our own tooling. See #1171.
      expect(facts).toContain('aicommerceacceleratorfrontend.aica-e2e.demo');
      expect(facts).not.toContain(
        'ai-commerce-accelerator-frontend.aica-e2e.demo'
      );
      // And the hyphenated one is still used where that is what the id says.
      expect(facts).toContain(
        'ai-commerce-accelerator-microservice.aica-e2e.demo'
      );
    });
  });

  test('no proxy is reported as such, and distinguished from a dead daemon', () => {
    sandbox((dir) => {
      const { facts } = runCapture(dir, { proxyPresent: false });
      expect(facts).toContain('(none found)');
      expect(facts).toContain('No proxy container on the target.');
      // "not deployed" and "docker is gone" produce the same empty name list.
      expect(facts).toMatch(/docker ps exit status: \d/);
    });
  });
});
