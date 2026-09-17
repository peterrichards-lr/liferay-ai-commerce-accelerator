#!/usr/bin/env node

/**
 * Registering a remote compute node with the MAC its licence is bound to.
 *
 * A CI runner is ephemeral: `~/.ldmrc` starts empty, so there is no target for
 * `--node` to resolve and nothing carrying a MAC. `manage_target_nodes.py`
 * updates a woken node's address, but only `if node_name in targets` - it
 * refreshes an entry, it never creates one.
 *
 * Without a configured MAC the container takes a bridge address, the run exits
 * 0, `License registered` appears in the log, and the portal serves the
 * Activation page. Nothing mentions the MAC. That is the failure #1752 exists
 * to prevent and the one this repository spent two CI runs diagnosing (#805).
 *
 * Both facts are derived rather than stored. The address changes whenever the
 * instance stops, so a recorded one would be wrong by definition; the ENI's MAC
 * is a property of the instance, so asking the instance cannot drift from it.
 * Neither belongs in a secret.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.resolve(__dirname, '..', '.node-power-config.json');

function nodeFromConfig(config, name) {
  const node = config?.nodes?.[name];

  if (!node) {
    const known = Object.keys(config?.nodes || {}).join(', ') || 'none';

    throw new Error(
      `No node '${name}' in .node-power-config.json (known: ${known})`
    );
  }

  if (!node.ec2_instance_id || !node.region) {
    throw new Error(
      `Node '${name}' has no ec2_instance_id or region, so neither its address nor its MAC can be derived`
    );
  }

  return {
    instanceId: node.ec2_instance_id,
    region: node.region,
    user: node.user || 'ec2-user',
  };
}

/**
 * The address and MAC of the instance's primary interface.
 *
 * A stopped instance has no public address, which is worth telling apart from a
 * malformed reply: the caller forgot to wake it, and saying so is more useful
 * than a parse error.
 */
function parseDescribe(payload) {
  const instance = payload?.Reservations?.[0]?.Instances?.[0];

  if (!instance) {
    throw new Error('AWS returned no instance for that id');
  }

  const host = instance.PublicIpAddress;
  const mac = instance.NetworkInterfaces?.[0]?.MacAddress;

  if (!host) {
    throw new Error(
      `Instance ${instance.InstanceId || ''} has no public address; it is probably not running`.trim()
    );
  }

  if (!mac) {
    throw new Error('Instance reports no network interface MAC address');
  }

  return { host, mac: mac.toLowerCase() };
}

function buildTargetAddArgs({ name, host, user, keyPath, mac }) {
  return [
    'target',
    'add',
    name,
    '--host',
    host,
    '--user',
    user,
    '--key',
    keyPath,
    '--mac-address',
    mac,
    '-y',
  ];
}

function describeInstance({ instanceId, region }) {
  const out = execFileSync(
    'aws',
    [
      'ec2',
      'describe-instances',
      '--instance-ids',
      instanceId,
      '--region',
      region,
      '--output',
      'json',
    ],
    { encoding: 'utf8' }
  );

  return JSON.parse(out);
}

async function register(
  name,
  {
    keyPath,
    readConfig = () => JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')),
    describe = describeInstance,
    run = (args) =>
      execFileSync('ldm', args, { encoding: 'utf8', stdio: 'inherit' }),
    log = console.log,
  } = {}
) {
  const { instanceId, region, user } = nodeFromConfig(readConfig(), name);
  const { host, mac } = parseDescribe(describe({ instanceId, region }));

  log(`  ${name}: ${host} (${user}), NIC ${mac}`);

  run(buildTargetAddArgs({ name, host, user, keyPath, mac }));

  return { name, host, user, mac };
}

async function main() {
  const [name, keyPath = `${process.env.HOME}/.ssh/aws-key.pem`] =
    process.argv.slice(2);

  if (!name) {
    console.error(
      'Usage: register-target-node.cjs <node-name> [ssh-key-path]\n\n' +
        'Derives the address and NIC MAC from AWS and registers the node with\n' +
        'ldm, so a MAC-bound licence can activate on it.'
    );
    process.exit(2);
  }

  try {
    await register(name, { keyPath });
    console.log(`🔑 Registered '${name}' with its NIC MAC.`);
  } catch (error) {
    console.error(`❌ Could not register '${name}': ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildTargetAddArgs,
  nodeFromConfig,
  parseDescribe,
  register,
};
