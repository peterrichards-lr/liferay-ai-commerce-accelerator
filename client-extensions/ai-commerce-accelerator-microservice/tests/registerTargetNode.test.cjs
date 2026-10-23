const {
  buildTargetAddArgs,
  nodeFromConfig,
  parseDescribe,
  register,
} = require('../../../scripts/register-target-node.cjs');

/**
 * A CI runner has no `~/.ldmrc`, so `--node node-a` resolves nothing and no MAC
 * is configured. The consequence is the failure #1752 describes and #805 spent
 * two CI runs on: bridge MAC, exit 0, `License registered` in the log, and the
 * portal serving the Activation page (#805).
 *
 * Both facts are derived from the instance rather than stored. The fixtures
 * below are the real shapes - `.node-power-config.json` as LDM publishes it,
 * and `aws ec2 describe-instances --output json` as the CLI returns it.
 */

const CONFIG = {
  timezone: 'Europe/London',
  nodes: {
    'node-a': {
      name: 'node-a',
      ec2_instance_id: 'i-0123456789abcdef0',
      region: 'xx-example-1',
      schedule: 'auto',
      user: 'ldm-automation',
    },
  },
};

const describePayload = (over = {}) => ({
  Reservations: [
    {
      Instances: [
        {
          InstanceId: 'i-0123456789abcdef0',
          PublicIpAddress: '203.0.113.10',
          NetworkInterfaces: [{ MacAddress: '00:00:5E:00:53:A7' }],
          ...over,
        },
      ],
    },
  ],
});

describe('register-target-node (#805)', () => {
  describe('reading the central config', () => {
    it('takes the instance, region and user', () => {
      expect(nodeFromConfig(CONFIG, 'node-a')).toEqual({
        instanceId: 'i-0123456789abcdef0',
        region: 'xx-example-1',
        user: 'ldm-automation',
      });
    });

    // The published config says `ldm-automation`; assuming `ec2-user` because
    // that is what a developer's ~/.ssh/config happens to use would register
    // the wrong identity.
    it('honours the configured user rather than assuming one', () => {
      expect(nodeFromConfig(CONFIG, 'node-a').user).toBe('ldm-automation');
    });

    it('falls back only when the config states no user', () => {
      const bare = { nodes: { 'node-a': { ...CONFIG.nodes['node-a'] } } };
      delete bare.nodes['node-a'].user;

      expect(nodeFromConfig(bare, 'node-a').user).toBe('ec2-user');
    });

    it('names the nodes it does know when asked for one it does not', () => {
      expect(() => nodeFromConfig(CONFIG, 'aws-9')).toThrow(/known: node-a/);
    });

    it('refuses a node with no instance id or region', () => {
      expect(() =>
        nodeFromConfig({ nodes: { 'node-a': { name: 'node-a' } } }, 'node-a')
      ).toThrow(/neither its address nor its MAC/);
    });
  });

  describe('reading the instance', () => {
    it('takes the public address and the primary NIC MAC', () => {
      expect(parseDescribe(describePayload())).toEqual({
        host: '203.0.113.10',
        mac: '00:00:5e:00:53:a7',
      });
    });

    // Liferay compares lowercase; AWS returns uppercase. A licence that matches
    // would appear not to.
    it('lowercases the MAC, because AWS returns it uppercase', () => {
      expect(parseDescribe(describePayload()).mac).toBe('00:00:5e:00:53:a7');
    });

    // A stopped instance has no address. Saying so beats a parse error,
    // because the remedy is to wake it.
    it('says the instance is probably not running when it has no address', () => {
      const stopped = describePayload({ PublicIpAddress: undefined });

      expect(() => parseDescribe(stopped)).toThrow(/probably not running/);
    });

    it('refuses an instance reporting no interface MAC', () => {
      expect(() =>
        parseDescribe(describePayload({ NetworkInterfaces: [] }))
      ).toThrow(/no network interface MAC/);
    });

    it('refuses an empty reply rather than reading undefined', () => {
      expect(() => parseDescribe({ Reservations: [] })).toThrow(
        /no instance for that id/
      );
    });
  });

  // EC2 assigns the address at each start, so it is not in NODE_POWER_CONFIG
  // for the job's up-front masking to know. #1383.
  describe('masking what it discovers (#1383)', () => {
    const captured = () => {
      const lines = [];
      const spy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk) => {
          lines.push(String(chunk));
          return true;
        });
      return { lines, restore: () => spy.mockRestore() };
    };

    it('masks the address and MAC in a GitHub Actions log', () => {
      const saved = process.env.GITHUB_ACTIONS;
      process.env.GITHUB_ACTIONS = 'true';
      const out = captured();
      try {
        parseDescribe(describePayload());
      } finally {
        out.restore();
        if (saved === undefined) delete process.env.GITHUB_ACTIONS;
        else process.env.GITHUB_ACTIONS = saved;
      }

      expect(out.lines).toContain('::add-mask::203.0.113.10\n');
      expect(
        out.lines.some((l) => /^::add-mask::[0-9a-f:]{17}\n$/.test(l))
      ).toBe(true);
    });

    it('prints nothing outside Actions', () => {
      const saved = process.env.GITHUB_ACTIONS;
      delete process.env.GITHUB_ACTIONS;
      const out = captured();
      try {
        parseDescribe(describePayload());
      } finally {
        out.restore();
        if (saved !== undefined) process.env.GITHUB_ACTIONS = saved;
      }

      expect(out.lines.filter((l) => l.startsWith('::add-mask::'))).toEqual([]);
    });
  });

  describe('the command it runs', () => {
    it('passes the MAC, host, user and key to ldm target add', () => {
      const args = buildTargetAddArgs({
        name: 'node-a',
        host: '203.0.113.10',
        user: 'ldm-automation',
        keyPath: '/home/runner/.ssh/aws-key.pem',
        mac: '00:00:5e:00:53:a7',
      });

      expect(args.slice(0, 3)).toEqual(['target', 'add', 'node-a']);
      expect(args).toContain('--mac-address');
      expect(args[args.indexOf('--mac-address') + 1]).toBe('00:00:5e:00:53:a7');
      expect(args[args.indexOf('--host') + 1]).toBe('203.0.113.10');
      expect(args[args.indexOf('--user') + 1]).toBe('ldm-automation');
      expect(args).toContain('-y');
    });
  });

  describe('end to end, with AWS and ldm injected', () => {
    it('registers the node with the MAC derived from the instance', async () => {
      const run = vi.fn();
      const result = await register('node-a', {
        keyPath: '/k.pem',
        readConfig: () => CONFIG,
        describe: () => describePayload(),
        run,
        log: () => {},
      });

      expect(result).toEqual({
        name: 'node-a',
        host: '203.0.113.10',
        user: 'ldm-automation',
        mac: '00:00:5e:00:53:a7',
      });
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0][0]).toContain('--mac-address');
    });

    // Registering a node with no MAC is the state this exists to prevent; it
    // must fail rather than register something unpinned.
    it('does not register anything when the MAC cannot be derived', async () => {
      const run = vi.fn();

      await expect(
        register('node-a', {
          keyPath: '/k.pem',
          readConfig: () => CONFIG,
          describe: () => describePayload({ NetworkInterfaces: [] }),
          run,
          log: () => {},
        })
      ).rejects.toThrow(/MAC/);

      expect(run).not.toHaveBeenCalled();
    });

    it('does not register anything when the instance is stopped', async () => {
      const run = vi.fn();

      await expect(
        register('node-a', {
          keyPath: '/k.pem',
          readConfig: () => CONFIG,
          describe: () => describePayload({ PublicIpAddress: undefined }),
          run,
          log: () => {},
        })
      ).rejects.toThrow(/not running/);

      expect(run).not.toHaveBeenCalled();
    });
  });
});
