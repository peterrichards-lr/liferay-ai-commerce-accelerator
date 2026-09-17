const {
  buildTargetAddArgs,
  nodeFromConfig,
  parseDescribe,
  register,
} = require('../../../scripts/register-target-node.cjs');

/**
 * A CI runner has no `~/.ldmrc`, so `--node aws-1` resolves nothing and no MAC
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
    'aws-1': {
      name: 'aws-1',
      ec2_instance_id: 'i-049889a61ec29e7ce',
      region: 'eu-north-1',
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
          InstanceId: 'i-049889a61ec29e7ce',
          PublicIpAddress: '13.49.210.78',
          NetworkInterfaces: [{ MacAddress: '06:D0:95:E5:26:A7' }],
          ...over,
        },
      ],
    },
  ],
});

describe('register-target-node (#805)', () => {
  describe('reading the central config', () => {
    it('takes the instance, region and user', () => {
      expect(nodeFromConfig(CONFIG, 'aws-1')).toEqual({
        instanceId: 'i-049889a61ec29e7ce',
        region: 'eu-north-1',
        user: 'ldm-automation',
      });
    });

    // The published config says `ldm-automation`; assuming `ec2-user` because
    // that is what a developer's ~/.ssh/config happens to use would register
    // the wrong identity.
    it('honours the configured user rather than assuming one', () => {
      expect(nodeFromConfig(CONFIG, 'aws-1').user).toBe('ldm-automation');
    });

    it('falls back only when the config states no user', () => {
      const bare = { nodes: { 'aws-1': { ...CONFIG.nodes['aws-1'] } } };
      delete bare.nodes['aws-1'].user;

      expect(nodeFromConfig(bare, 'aws-1').user).toBe('ec2-user');
    });

    it('names the nodes it does know when asked for one it does not', () => {
      expect(() => nodeFromConfig(CONFIG, 'aws-9')).toThrow(/known: aws-1/);
    });

    it('refuses a node with no instance id or region', () => {
      expect(() =>
        nodeFromConfig({ nodes: { 'aws-1': { name: 'aws-1' } } }, 'aws-1')
      ).toThrow(/neither its address nor its MAC/);
    });
  });

  describe('reading the instance', () => {
    it('takes the public address and the primary NIC MAC', () => {
      expect(parseDescribe(describePayload())).toEqual({
        host: '13.49.210.78',
        mac: '06:d0:95:e5:26:a7',
      });
    });

    // Liferay compares lowercase; AWS returns uppercase. A licence that matches
    // would appear not to.
    it('lowercases the MAC, because AWS returns it uppercase', () => {
      expect(parseDescribe(describePayload()).mac).toBe('06:d0:95:e5:26:a7');
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

  describe('the command it runs', () => {
    it('passes the MAC, host, user and key to ldm target add', () => {
      const args = buildTargetAddArgs({
        name: 'aws-1',
        host: '13.49.210.78',
        user: 'ldm-automation',
        keyPath: '/home/runner/.ssh/aws-key.pem',
        mac: '06:d0:95:e5:26:a7',
      });

      expect(args.slice(0, 3)).toEqual(['target', 'add', 'aws-1']);
      expect(args).toContain('--mac-address');
      expect(args[args.indexOf('--mac-address') + 1]).toBe('06:d0:95:e5:26:a7');
      expect(args[args.indexOf('--host') + 1]).toBe('13.49.210.78');
      expect(args[args.indexOf('--user') + 1]).toBe('ldm-automation');
      expect(args).toContain('-y');
    });
  });

  describe('end to end, with AWS and ldm injected', () => {
    it('registers the node with the MAC derived from the instance', async () => {
      const run = vi.fn();
      const result = await register('aws-1', {
        keyPath: '/k.pem',
        readConfig: () => CONFIG,
        describe: () => describePayload(),
        run,
        log: () => {},
      });

      expect(result).toEqual({
        name: 'aws-1',
        host: '13.49.210.78',
        user: 'ldm-automation',
        mac: '06:d0:95:e5:26:a7',
      });
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0][0]).toContain('--mac-address');
    });

    // Registering a node with no MAC is the state this exists to prevent; it
    // must fail rather than register something unpinned.
    it('does not register anything when the MAC cannot be derived', async () => {
      const run = vi.fn();

      await expect(
        register('aws-1', {
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
        register('aws-1', {
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
