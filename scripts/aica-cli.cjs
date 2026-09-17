#!/usr/bin/env node

/**
 * Liferay AI Commerce Accelerator (AICA) - Zero-Dependency Headless CLI Client
 * Hides Node.js execution details, leveraging Configuration-by-Convention for ultra-fast seeding!
 */

const fs = require('fs');
const path = require('path');

// --- 1. Dynamic .env / Convention Discovery ---
function loadEnv() {
  const searchPaths = [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '../..'),
  ];

  for (const dir of searchPaths) {
    const envPath = path.join(dir, '.env');
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return;
          const index = trimmed.indexOf('=');
          if (index === -1) return;
          const key = trimmed.slice(0, index).trim();
          let value = trimmed.slice(index + 1).trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = value;
          }
        });
        break;
      } catch (e) {
        // Fallback silently if unreadable
      }
    }
  }
}

loadEnv();

// --- 2. Environment Configurations & Defaults ---
const MICROSERVICE_URL =
  process.env.AICA_MICROSERVICE_URL || 'http://localhost:3001';
const LIFERAY_URL =
  process.env.LIFERAY_PORTAL_URL ||
  process.env.LIFERAY_URL ||
  process.env.LIFERAY_API_URL ||
  'https://aica-e2e.demo';
// The destructive routes are gated on an administrator *account*, and the
// client credentials below authenticate the microservice to Liferay rather than
// the operator to the microservice - the CLI has never sent a credential of its
// own. Supplying a user's bearer token is what makes `delete` and `config set`
// reach their endpoints at all (#930).
const ADMIN_TOKEN = process.env.AICA_ADMIN_TOKEN || '';

const LIFERAY_USERNAME = process.env.LIFERAY_API_USERNAME || 'test@liferay.com';
const LIFERAY_PASSWORD = process.env.LIFERAY_API_PASSWORD || 'test';

/**
 * Every input `buildConfigAndOptions` (microservice `utils/normalize.cjs`)
 * will read off `req.body` for a generate run, and how a CLI flag reaches it.
 *
 * One table drives the argument parser, `--help`, and the payload
 * `handleGenerate` sends - a key with no row here is a visible gap in this
 * file, rather than one spread invisibly across a hand-written parsing loop
 * and a hand-built payload. That drift is how #735 happened: the payload
 * carried 22 keys by hand against 57 the microservice accepted, five of the
 * 22 were hardcoded rather than actually settable, and nothing said so until
 * an operator hit a refusal `--accounts 0` could not work around because the
 * guard was on `accountType`, a field the CLI had no flag for at all.
 * `tests/cliOptionCoverage.test.cjs` reads the destructured key list back out
 * of `normalize.cjs` and fails if this table (plus WITHHELD_GENERATE_KEYS)
 * ever stops covering it, so the next field added there cannot drift silently
 * the way these 35 did.
 *
 * `type`: 'string' passes the raw value through; 'integer' validates with
 * `requireInteger`; 'boolean' is `--flag` / `--no-flag`; 'list' splits on
 * commas into an array (of numbers when `listOf: 'integer'`), because a
 * field like `selectedLanguages` is assigned to directly in `normalize.cjs`
 * with no string-to-array parsing of its own - sending it as a bare
 * comma-string would reach the workflow as a string, not a list.
 */
const GENERATE_OPTIONS = [
  // Pre-existing flags, unchanged: same flag name, same default, same
  // validation as before this table existed.
  {
    key: 'demoMode',
    type: 'boolean',
    flag: 'demo',
    default: false,
    help: 'Use Mock Data instead of Gemini AI',
  },
  {
    key: 'productCount',
    type: 'integer',
    flag: 'products',
    min: 0,
    default: 2,
    help: 'Specify product target volume',
  },
  {
    key: 'accountCount',
    type: 'integer',
    flag: 'accounts',
    min: 0,
    default: 2,
    help: 'Specify business accounts volume',
  },
  {
    key: 'orderCount',
    type: 'integer',
    flag: 'orders',
    min: 0,
    default: 5,
    help: 'Specify order target volume',
  },
  {
    key: 'imageMode',
    type: 'string',
    flag: 'images',
    aliases: ['image-mode'],
    placeholder: '<mode>',
    default: 'default',
    help: 'Specify image generation mode (none|default|picsum|ai)',
  },
  {
    key: 'pdfMode',
    type: 'string',
    flag: 'pdfs',
    aliases: ['pdf-mode'],
    placeholder: '<mode>',
    default: 'default',
    help: 'Specify PDF generation mode (none|default|ai)',
  },
  {
    key: 'generateBulkPricing',
    type: 'boolean',
    flag: 'bulk-pricing',
    default: true,
    help: 'Enable/disable bulk pricing generation',
  },
  {
    key: 'generateTierPricing',
    type: 'boolean',
    flag: 'tier-pricing',
    default: true,
    help: 'Enable/disable tier pricing generation',
  },
  {
    key: 'generateSpecifications',
    type: 'boolean',
    flag: 'specifications',
    default: true,
    help: 'Enable/disable specification generation',
  },
  {
    key: 'createWarehouses',
    type: 'boolean',
    flag: 'warehouses',
    default: true,
    help: 'Enable/disable warehouse creation',
  },
  {
    key: 'warehouseCount',
    type: 'integer',
    flag: 'warehouse-count',
    min: 0,
    default: 1,
    help: 'Specify how many warehouses to create',
  },
  {
    key: 'channelId',
    type: 'integer',
    flag: 'channel-id',
    aliases: ['channel'],
    placeholder: 'ID',
    min: 1,
    help: 'Specify channel ID',
  },
  {
    key: 'siteGroupId',
    type: 'integer',
    flag: 'site-group-id',
    aliases: ['site-group'],
    placeholder: 'ID',
    min: 1,
    help: 'Specify site group ID',
  },
  {
    key: 'catalogId',
    type: 'integer',
    flag: 'catalog-id',
    aliases: ['catalog'],
    placeholder: 'ID',
    min: 1,
    help: 'Specify catalog ID',
  },

  // Sent by handleGenerate but hardcoded rather than settable, per #735.
  {
    key: 'generatePriceLists',
    type: 'boolean',
    flag: 'price-lists',
    default: true,
    help: 'Enable/disable price list generation',
  },
  {
    key: 'generateSkuVariants',
    type: 'boolean',
    flag: 'sku-variants',
    default: true,
    help: 'Enable/disable SKU variant generation',
  },
  {
    key: 'localeCode',
    type: 'string',
    flag: 'locale-code',
    default: 'en-US',
    help: 'Locale for generated content, e.g. fr-FR',
  },
  {
    key: 'languageId',
    type: 'string',
    flag: 'language-id',
    default: 'en_US',
    help: 'Liferay language id for generated content, e.g. fr_FR',
  },
  {
    key: 'currencyCode',
    type: 'string',
    flag: 'currency-code',
    default: 'USD',
    help: 'Currency for generated pricing, e.g. EUR',
  },

  // Previously reachable from no CLI flag at all - the bulk of #735's 35.
  {
    key: 'accountType',
    type: 'string',
    flag: 'account-type',
    help: 'Account type to generate: person|business - the flag a channel with no commerce site type set is telling you to pick when it refuses a business-account run',
  },
  {
    key: 'orderAccountType',
    type: 'string',
    flag: 'order-account-type',
    help: 'Restrict a standalone order run to existing accounts of this type',
  },
  {
    key: 'businessAccountRatio',
    type: 'integer',
    flag: 'business-account-ratio',
    min: 0,
    help: 'Percent of generated accounts that are business accounts, for the mixed account type',
  },
  {
    key: 'orderDateRangeDays',
    type: 'integer',
    flag: 'order-date-range-days',
    min: 0,
    help: 'Spread generated order dates over this many days',
  },
  {
    key: 'orderDistribution',
    type: 'string',
    flag: 'order-distribution',
    placeholder: '<json>',
    help: 'JSON object describing how orders are distributed over time',
  },
  {
    key: 'inventoryMin',
    type: 'integer',
    flag: 'inventory-min',
    min: 0,
    help: 'Minimum inventory quantity assigned per product',
  },
  {
    key: 'inventoryMax',
    type: 'integer',
    flag: 'inventory-max',
    min: 0,
    help: 'Maximum inventory quantity assigned per product',
  },
  {
    key: 'inventoryAssignmentRatio',
    type: 'integer',
    flag: 'inventory-assignment-ratio',
    min: 0,
    help: 'Percent of products that receive an inventory assignment',
  },
  {
    key: 'enableBackorders',
    type: 'boolean',
    flag: 'enable-backorders',
    default: false,
    help: 'Enable/disable backorder generation',
  },
  {
    key: 'backorderAssignmentRatio',
    type: 'integer',
    flag: 'backorder-assignment-ratio',
    min: 0,
    help: 'Percent of inventory-assigned products flagged for backorder',
  },
  {
    key: 'reuseExistingWarehouses',
    type: 'boolean',
    flag: 'reuse-existing-warehouses',
    default: true,
    help: 'Reuse existing warehouses instead of creating new ones',
  },
  {
    key: 'brandName',
    type: 'string',
    flag: 'brand-name',
    help: 'Brand name to theme generated content around',
  },
  {
    key: 'categories',
    type: 'list',
    listOf: 'string',
    flag: 'categories',
    help: 'Comma-separated product category names',
  },
  {
    key: 'geographicContext',
    type: 'string',
    flag: 'geographic-context',
    placeholder: '<text|json>',
    help: 'Geographic context for generated content',
  },
  {
    key: 'sessionName',
    type: 'string',
    flag: 'session-name',
    help: 'Label for this generation session',
  },
  {
    key: 'seedPack',
    type: 'string',
    flag: 'seed-pack',
    help: 'Name of a seed pack to generate from',
  },
  {
    key: 'generatePromotions',
    type: 'boolean',
    flag: 'generate-promotions',
    default: false,
    help: 'Enable/disable promotion generation',
  },
  {
    key: 'imageWidth',
    type: 'integer',
    flag: 'image-width',
    min: 1,
    help: 'Generated image width in pixels',
  },
  {
    key: 'imageHeight',
    type: 'integer',
    flag: 'image-height',
    min: 1,
    help: 'Generated image height in pixels',
  },
  {
    key: 'imageQuality',
    type: 'string',
    flag: 'image-quality',
    help: 'Generated image quality, e.g. standard|hd',
  },
  {
    key: 'imageStyle',
    type: 'string',
    flag: 'image-style',
    help: 'Generated image style, e.g. photographic',
  },
  {
    key: 'imageRatio',
    type: 'integer',
    flag: 'image-ratio',
    min: 0,
    help: 'Percent of products that receive an image',
  },
  {
    key: 'pdfRatio',
    type: 'integer',
    flag: 'pdf-ratio',
    min: 0,
    help: 'Percent of products that receive a PDF attachment',
  },
  {
    key: 'pdfContentType',
    type: 'string',
    flag: 'pdf-content-type',
    help: 'Content focus for generated PDFs',
  },
  {
    key: 'mediaBundleKey',
    type: 'string',
    flag: 'media-bundle-key',
    help: 'Attach media from a cached bundle instead of generating it',
  },
  {
    key: 'selectedLanguages',
    type: 'list',
    listOf: 'string',
    flag: 'selected-languages',
    help: 'Comma-separated locales to translate generated content into',
  },
  {
    key: 'channelIds',
    type: 'list',
    listOf: 'integer',
    min: 1,
    flag: 'channel-ids',
    help: "Comma-separated channel IDs this run's data should also be available in, besides --channel-id (#664)",
  },
  {
    key: 'aiModel',
    type: 'string',
    flag: 'ai-model',
    help: 'AI model to use for generation',
  },
  {
    key: 'batchSize',
    type: 'integer',
    flag: 'batch-size',
    min: 1,
    help: 'Number of items to process per batch',
  },
  {
    key: 'pollingDelay',
    type: 'integer',
    flag: 'polling-delay',
    min: 0,
    help: 'Milliseconds between workflow status polls',
  },
  {
    key: 'pollingRetries',
    type: 'integer',
    flag: 'polling-retries',
    min: 0,
    help: 'Maximum number of status poll attempts',
  },
  {
    key: 'requestTimeoutMs',
    type: 'integer',
    flag: 'request-timeout-ms',
    min: 0,
    help: 'Timeout in milliseconds for AI provider requests',
  },
];

/**
 * `buildConfigAndOptions` inputs deliberately left without a flag, and why.
 * Not an oversight list - `tests/cliOptionCoverage.test.cjs` requires every
 * key destructured there to appear in GENERATE_OPTIONS or here, so a key
 * missing from both fails the build rather than just going unmentioned.
 */
const WITHHELD_GENERATE_KEYS = {
  clientId:
    'Credential. Sourced from LIFERAY_API_CLIENT_ID via the .env cascade this CLI already reads, so it never has to be typed on the command line where it would land in shell history and process listings.',
  clientSecret:
    'Credential. Sourced from LIFERAY_API_CLIENT_SECRET - same reasoning as clientId.',
  liferayUrl:
    'Connection target, not a generation input. Resolved from the LIFERAY_PORTAL_URL/LIFERAY_URL/LIFERAY_API_URL .env cascade this CLI already uses for every command (connect, delete, export, ...), not only generate.',
  authMethod:
    'Connection resolution detail (oauth vs basic), decided together with liferayUrl/clientId/clientSecret in resolveEffectiveLiferayConnection rather than chosen per generate run.',
  microserviceUrl:
    'Lets a browser client behind a reverse proxy tell the server its own externally-visible origin, for constructing callback links. A CLI talking to the microservice directly already supplies that origin as MICROSERVICE_URL/AICA_MICROSERVICE_URL - the request target itself - so sending it again in the body would be redundant plumbing, not a generation input.',
  chunkSizes:
    "A structured per-phase tuning object that normalize.cjs passes through unvalidated, not a scalar/boolean/list a single flag can express cleanly. AI-runtime tuning, not something a demo run's content depends on.",
};

/** `--flag <value>` / `--no-flag` names an entry answers to, boolean-aware. */
function generateOptionFlagNames(opt, negate) {
  const names = [opt.flag, ...(opt.aliases || [])];
  return opt.type === 'boolean'
    ? names.map((name) => `--${negate ? 'no-' : ''}${name}`)
    : names.map((name) => `--${name}`);
}

function findGenerateOption(arg) {
  for (const opt of GENERATE_OPTIONS) {
    if (generateOptionFlagNames(opt, false).includes(arg)) {
      return { negate: false, opt };
    }
    if (
      opt.type === 'boolean' &&
      generateOptionFlagNames(opt, true).includes(arg)
    ) {
      return { negate: true, opt };
    }
  }
  return null;
}

/**
 * `channelIds`/`selectedLanguages`/`categories` are read by normalize.cjs as
 * arrays, not as a delimited string it parses itself (unlike, say,
 * `orderDistribution`, which does get parsed). Splitting here rather than
 * server-side means a JSON request body - what this CLI always sends - can
 * carry a real array instead of a string the consumer never unpacks.
 */
function parseListValue(flag, raw, opt) {
  const items = String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return opt.listOf === 'integer'
    ? items.map((item) => requireInteger(flag, item, opt.min ?? 0))
    : items;
}

/**
 * Table-driven half of argument parsing: every field `buildConfigAndOptions`
 * accepts for a generate run. A flag this function does not recognise is
 * left untouched, same as every flag check here always has been - an unknown
 * `--flag` is silently ignored rather than refused.
 */
function parseGenerateArgs(flagArgs) {
  const options = {};

  for (let i = 0; i < flagArgs.length; i++) {
    const arg = flagArgs[i];
    const found = findGenerateOption(arg);
    if (!found) continue;

    const { negate, opt } = found;

    if (opt.type === 'boolean') {
      options[opt.key] = !negate;
      continue;
    }

    if (opt.type === 'integer') {
      options[opt.key] = requireInteger(arg, flagArgs[i + 1], opt.min ?? 0);
      i++;
      continue;
    }

    // String/list flags: consumed only when a value actually follows, same
    // as the pre-existing --images/--pdfs handling this generalises. A
    // missing value is left for the next iteration rather than refused.
    const raw = flagArgs[i + 1];
    if (raw === undefined) continue;
    i++;
    options[opt.key] =
      opt.type === 'list' ? parseListValue(arg, raw, opt) : raw;
  }

  return options;
}

/** Control flags shared by non-generate commands; not a generate input. */
function parseControlOptions(flagArgs) {
  const options = {};

  for (let i = 0; i < flagArgs.length; i += 1) {
    const arg = flagArgs[i];

    if (arg === '--all') options.all = true;
    if (arg === '--selected') options.selected = true;
    if (arg === '-y' || arg === '--yes' || arg === '--non-interactive') {
      options.nonInteractive = true;
    }
    if (arg === '--docker') options.docker = true;
    if (arg === '--api') options.api = true;
    if (arg === '--bundle' || arg === '--with-media') options.bundle = true;
    if (arg === '--instance') options.instance = true;

    if (arg === '--token') {
      options.token = flagArgs[i + 1];
      i += 1;
    } else if (arg.startsWith('--token=')) {
      options.token = arg.slice('--token='.length);
    }
  }

  return options;
}

/**
 * The payload `POST /api/v1/generate/workflow` receives, built from
 * GENERATE_OPTIONS rather than listed by hand - see the table's own comment
 * for why that hand-written list was the bug. Keys neither supplied nor
 * defaulted are left `undefined`, which `JSON.stringify` drops, so an
 * unsupplied field reaches the microservice exactly as it did when this
 * function did not exist: absent, letting normalize.cjs's own default apply.
 */
function buildGeneratePayload(opts, ctx) {
  const payload = { ...buildConnectionPayload() };

  for (const opt of GENERATE_OPTIONS) {
    const value = opts[opt.key] ?? opt.default;
    if (value !== undefined) payload[opt.key] = value;
  }

  // Resolved separately (env, interactive picker, or the backend) rather
  // than parsed straight off a flag, so these three always win over
  // whatever the loop above set from opts.channelId/siteGroupId/catalogId.
  payload.channelId = ctx.channelId;
  payload.siteGroupId = ctx.siteGroupId;
  payload.catalogId = ctx.catalogId;

  return payload;
}

/**
 * A supplied value is either used or refused, never quietly replaced.
 *
 * `--accounts 0` reached the payload as 2, because the defaulting was
 * `opts.accountCount || 2` and zero is falsy. Zero is the most useful value
 * these flags have - products with no orders is the shape of a fixture, and
 * accounts with no products is how an import target is prepared - so the
 * defaults now use `??`, and only absence takes the default (#927).
 *
 * That only holds while what the parser stores is a number or nothing at all.
 * `parseInt('abc', 10)` is `NaN`, which `??` would carry all the way to the
 * API where `||` used to substitute the default and hide it, so a value that
 * does not parse is refused here, naming the flag that carried it.
 */
function requireInteger(flag, raw, min) {
  const value = Number(raw);

  if (!Number.isInteger(value) || value < min) {
    console.error(
      `❌ ${flag} expects a whole number of ${min} or more, and was given ${
        raw === undefined ? 'nothing' : `"${raw}"`
      }.`
    );
    process.exit(1);
  }

  return value;
}

/**
 * Argument parsing and command dispatch, gated behind `require.main` so this
 * file can also be `require`d for its data - GENERATE_OPTIONS,
 * WITHHELD_GENERATE_KEYS, parseGenerateArgs, buildGeneratePayload - without
 * running the CLI. `tests/cliOptionCoverage.test.cjs` and
 * `tests/cliParseGenerateArgs.test.cjs` depend on that; `tests/cliCounts.test.cjs`
 * still spawns the real binary, deliberately, to exercise the whole path
 * end to end rather than a helper the argument loop might one day stop
 * calling.
 */
function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (
    !command ||
    [
      'connect',
      'generate',
      'delete',
      'export',
      'extract',
      'import',
      'config',
      'reindex',
      '--help',
      '-h',
    ].includes(command) === false
  ) {
    printHelp();
    process.exit(1);
  }

  if (command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  const flagArgs = args.slice(1);
  const options = {
    ...parseControlOptions(flagArgs),
    ...parseGenerateArgs(flagArgs),
  };

  // --- 4. Main Command Routing Router ---
  (async () => {
    try {
      switch (command) {
        case 'connect':
          await handleConnect();
          break;
        case 'generate':
          await handleGenerate(options);
          break;
        case 'delete':
          await handleDelete(options);
          break;
        case 'export':
          await handleExport(args[1], args[2], options);
          break;
        case 'extract':
          await handleExtract(args[1], args[2], options);
          break;
        case 'import':
          await handleImport(args[1]);
          break;
        case 'config':
          await handleConfig(args[1], args[2], args.slice(2));
          break;
        case 'reindex':
          await handleReindex(args[1], options);
          break;
      }
    } catch (err) {
      console.error(`\n❌ Error: ${err.message}`);
      process.exit(1);
    }
  })();
}

// --- 5. Command Handlers & Implementation ---

async function handleConnect() {
  console.log(`Connecting to AICA Microservice at: ${MICROSERVICE_URL}...`);
  const payload = buildConnectionPayload();

  const res = await nativePost(
    `${MICROSERVICE_URL}/api/v1/test-connection`,
    payload
  );
  if (res.success) {
    console.log(
      `\n🟢 Handshake Successful! Connected to Liferay at: ${LIFERAY_URL}`
    );
    console.log(`OAuth2 Session Established.`);
  } else {
    throw new Error(res.error || 'Handshake failed.');
  }
}

function toNumber(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = parseInt(v, 10);
  return isNaN(n) ? undefined : n;
}

async function askQuestion(query) {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

async function resolveCommerceContext(opts) {
  let channelId =
    opts.channelId ??
    toNumber(process.env.AICA_CHANNEL_ID || process.env.LIFERAY_CHANNEL_ID);
  let siteGroupId =
    opts.siteGroupId ??
    toNumber(
      process.env.AICA_SITE_GROUP_ID || process.env.LIFERAY_SITE_GROUP_ID
    );
  let catalogId =
    opts.catalogId ??
    toNumber(process.env.AICA_CATALOG_ID || process.env.LIFERAY_CATALOG_ID);

  const isNonInteractive =
    opts.nonInteractive || !process.stdout.isTTY || !process.stdin.isTTY;

  if (
    channelId !== undefined &&
    siteGroupId !== undefined &&
    catalogId !== undefined
  ) {
    return { channelId, siteGroupId, catalogId };
  }

  console.log(
    'Resolving commerce context (channels and catalogs) from Liferay...'
  );

  let channels = [];
  let catalogs = [];
  try {
    const creds = buildConnectionPayload();

    // Retry channel resolution up to 15 times (30 seconds) to allow Liferay to finish creating default sites during boot
    let attempt = 0;
    while (attempt < 15) {
      const channelsRes = await nativePost(
        `${MICROSERVICE_URL}/api/v1/get-channels`,
        creds
      );
      if (
        channelsRes &&
        channelsRes.success &&
        Array.isArray(channelsRes.channels) &&
        channelsRes.channels.length > 0
      ) {
        channels = channelsRes.channels;
        break;
      }
      attempt++;
      if (attempt < 15)
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const catalogsRes = await nativePost(
      `${MICROSERVICE_URL}/api/v1/get-catalogs`,
      creds
    );
    if (
      catalogsRes &&
      catalogsRes.success &&
      Array.isArray(catalogsRes.catalogs)
    ) {
      catalogs = catalogsRes.catalogs;
    }
  } catch (err) {
    console.warn(
      `⚠️ Warning: Failed to fetch active commerce context from microservice: ${err.message}`
    );
  }

  // A. Resolve channelId and siteGroupId
  if (channelId === undefined) {
    if (channels.length > 0) {
      if (channels.length === 1 || isNonInteractive) {
        channelId = parseInt(channels[0].id, 10);
        if (siteGroupId === undefined) {
          siteGroupId = parseInt(channels[0].siteGroupId, 10);
        }
        console.log(
          `Auto-selected Channel: ${channels[0].name} (ID: ${channelId})`
        );
      } else {
        console.log('\nAvailable Channels:');
        channels.forEach((c, index) => {
          console.log(
            `  ${index + 1}) ${c.name} (ID: ${c.id}, Site Group: ${c.siteGroupId})`
          );
        });
        const ans = await askQuestion(
          `Select a Channel (1-${channels.length}) or enter custom ID [1]: `
        );
        const selIdx = parseInt(ans, 10) - 1;
        if (!isNaN(selIdx) && selIdx >= 0 && selIdx < channels.length) {
          channelId = parseInt(channels[selIdx].id, 10);
          if (siteGroupId === undefined) {
            siteGroupId = parseInt(channels[selIdx].siteGroupId, 10);
          }
        } else if (ans !== '') {
          channelId = parseInt(ans, 10);
        } else {
          channelId = parseInt(channels[0].id, 10);
          if (siteGroupId === undefined) {
            siteGroupId = parseInt(channels[0].siteGroupId, 10);
          }
        }
      }
    }
  } else if (siteGroupId === undefined) {
    // If channelId was explicitly provided, try to find its matching siteGroupId
    const matchingChannel = channels.find(
      (c) => Number(c.id) === Number(channelId)
    );
    if (matchingChannel) {
      siteGroupId = parseInt(matchingChannel.siteGroupId, 10);
    }
  }

  // B. Resolve catalogId
  if (catalogId === undefined) {
    if (catalogs.length > 0) {
      if (catalogs.length === 1 || isNonInteractive) {
        catalogId = parseInt(catalogs[0].id, 10);
        console.log(
          `Auto-selected Catalog: ${catalogs[0].name} (ID: ${catalogId})`
        );
      } else {
        console.log('\nAvailable Catalogs:');
        catalogs.forEach((c, index) => {
          console.log(`  ${index + 1}) ${c.name} (ID: ${c.id})`);
        });
        const ans = await askQuestion(
          `Select a Catalog (1-${catalogs.length}) or enter custom ID [1]: `
        );
        const selIdx = parseInt(ans, 10) - 1;
        if (!isNaN(selIdx) && selIdx >= 0 && selIdx < catalogs.length) {
          catalogId = parseInt(catalogs[selIdx].id, 10);
        } else if (ans !== '') {
          catalogId = parseInt(ans, 10);
        } else {
          catalogId = parseInt(catalogs[0].id, 10);
        }
      }
    }
  }

  // C. Fallback interactive prompt if still missing and interactive
  if (!isNonInteractive) {
    if (channelId === undefined || isNaN(channelId)) {
      const ans = await askQuestion('Enter Channel ID: ');
      channelId = parseInt(ans, 10);
    }
    if (siteGroupId === undefined || isNaN(siteGroupId)) {
      const ans = await askQuestion('Enter Site Group ID: ');
      siteGroupId = parseInt(ans, 10);
    }
    if (catalogId === undefined || isNaN(catalogId)) {
      const ans = await askQuestion('Enter Catalog ID: ');
      catalogId = parseInt(ans, 10);
    }
  }

  // D. Delegate to backend if still missing
  if (
    channelId === undefined ||
    isNaN(channelId) ||
    siteGroupId === undefined ||
    isNaN(siteGroupId) ||
    catalogId === undefined ||
    isNaN(catalogId)
  ) {
    console.warn(
      '\n⚠️ Warning: Missing some commerce context settings locally. Delegating resolution to the backend.'
    );
  }

  return { channelId, siteGroupId, catalogId };
}

async function handleGenerate(opts) {
  console.log(`Initializing Data Generation...`);
  const ctx = await resolveCommerceContext(opts);

  const payload = buildGeneratePayload(opts, ctx);

  const res = await nativePost(
    `${MICROSERVICE_URL}/api/v1/generate/workflow`,
    payload
  );
  if (!res.success || !res.sessionId) {
    throw new Error(res.error || 'Failed to submit generation workflow.');
  }

  console.log(`\n🚀 Generation Workflow Started! Session ID: ${res.sessionId}`);
  await pollProgress(res.sessionId);
}

/**
 * The bearer token for a route reserved for administrator accounts.
 *
 * Refuses up front rather than sending a request the microservice will reject,
 * because the rejection it would produce - a 401 about signing headers - says
 * nothing about why an operator identity is needed. The client credentials the
 * CLI holds authenticate the microservice to Liferay; they are not an operator,
 * and no allowlist entry can make them one (#930).
 */
function adminToken(opts, command) {
  const token = (opts && opts.token) || ADMIN_TOKEN;

  if (!token) {
    throw new Error(
      `${command} acts on a route reserved for administrator accounts.\n` +
        `   The CLI's client credentials authenticate the microservice to Liferay;\n` +
        `   they are not an operator identity, so this route cannot accept them.\n` +
        `   Supply an administrator's bearer token with --token <token>, or set\n` +
        `   AICA_ADMIN_TOKEN, and add that account to AICA_ADMINS on the service.`
    );
  }

  return token;
}

async function handleDelete(opts) {
  const token = adminToken(opts, 'aica delete');
  const isSelected = opts.selected && !opts.all;
  const endpoint = isSelected
    ? 'delete-selected-commerce-data'
    : 'delete-commerce-data';
  console.log(
    `Initializing ${isSelected ? 'Selected' : 'All'} Commerce Data Deletion...`
  );

  const payload = {
    ...buildConnectionPayload(),
  };

  if (isSelected) {
    const ctx = await resolveCommerceContext(opts);
    payload.channelId = ctx.channelId;
    payload.siteGroupId = ctx.siteGroupId;
    payload.catalogId = ctx.catalogId;
  }

  const res = await nativePost(
    `${MICROSERVICE_URL}/api/v1/${endpoint}`,
    payload,
    { token }
  );
  const sessionId = res.sessionId || res.summary?.sessionId;
  if (!res.success || !sessionId) {
    throw new Error(res.error || 'Failed to submit deletion workflow.');
  }

  console.log(`\n🛑 Deletion Workflow Started! Session ID: ${sessionId}`);
  await pollProgress(sessionId);
}

/**
 * What a package reports about itself, printed rather than swallowed.
 *
 * The counts are the result of an export or an extract, not decoration: a
 * package that carries fewer pictures than its source still downloads, still
 * imports, and still looks like success. Anything above zero is said out loud
 * and the command exits non-zero on a required-field shortfall, so a script
 * that promotes a catalogue can stop rather than promote a thin one.
 */
function reportPackageCounts(headers) {
  const count = (name) => {
    const value = headers.get(name);
    return value === null ? null : Number(value);
  };

  const images = count('X-AICA-Media-Images');
  const pdfs = count('X-AICA-Media-Pdfs');
  const unresolved = count('X-AICA-Media-Unresolved');
  const incomplete = count('X-AICA-Products-Incomplete');
  const partial = count('X-AICA-Products-Partial');
  const source = headers.get('X-AICA-Media-Source');

  console.log(
    `   Media: ${images ?? 0} image(s), ${pdfs ?? 0} attachment(s)${source ? ` (from the ${source})` : ''}`
  );

  if (partial) {
    console.log(
      `   ${partial} product(s) are missing optional fields only - usually blank on the source`
    );
  }

  if (unresolved) {
    console.warn(
      `\n⚠️  ${unresolved} media item(s) could not be included. The package carries fewer pictures than its source.`
    );
  }

  if (incomplete) {
    console.warn(
      `\n⚠️  ${incomplete} product(s) are missing a field the schema requires; see metadata.translationReport inside the package.`
    );
  }

  return { images, incomplete, partial, pdfs, unresolved };
}

function packagePath(outputPath, fallbackName) {
  return outputPath
    ? path.resolve(process.cwd(), outputPath)
    : path.resolve(process.cwd(), `${fallbackName}.aicap`);
}

async function handleExport(sessionId, outputPath, opts = {}) {
  if (!sessionId) {
    throw new Error(
      'Please specify a sessionId to export (aica export <sessionId> [outputPath] [--bundle])'
    );
  }

  if (opts.bundle) {
    const resolvedPath = packagePath(outputPath, `aica-package-${sessionId}`);

    console.log(
      `Building a dataset package for ${sessionId} at: ${resolvedPath}...`
    );

    // The cheap half of the pair: this reads the media this service already
    // wrote to disk, so it calls no Liferay and needs no credentials.
    const { buffer, headers } = await nativeDownload(
      `${MICROSERVICE_URL}/api/v1/export-commerce-bundle?sessionId=${encodeURIComponent(sessionId)}`
    );

    fs.writeFileSync(resolvedPath, buffer);
    console.log(`\n🟢 Package written to disk! (${buffer.length} bytes)`);
    reportPackageCounts(headers);
    return;
  }

  const defaultPath = path.resolve(
    process.cwd(),
    `aica-dataset-${sessionId}.json`
  );
  const resolvedPath = outputPath
    ? path.resolve(process.cwd(), outputPath)
    : defaultPath;

  console.log(`Exporting session dataset ${sessionId} to: ${resolvedPath}...`);

  const res = await nativeGet(
    `${MICROSERVICE_URL}/api/v1/export-commerce-data?sessionId=${sessionId}`
  );
  if (!res || !res.products) {
    throw new Error(`Failed to retrieve dataset for session: ${sessionId}`);
  }

  fs.writeFileSync(resolvedPath, JSON.stringify(res, null, 2), 'utf8');
  console.log(
    `\n🟢 Dataset successfully written to disk! (${res.products.length} Products, ${res.accounts.length} Accounts, ${res.orders.length} Orders)`
  );
  console.log(
    `   No media: this is the dataset alone. Use --bundle for a package carrying its images and attachments.`
  );
}

/**
 * Pull a package out of a live Liferay.
 *
 * The expensive half: it authenticates against an instance and fetches every
 * binary across the network, where `export --bundle` reads a directory. Worth
 * it when the media was never written locally - a dataset generated before the
 * archive existed, or a catalogue this service did not build.
 *
 * The source is stated rather than inferred. `--instance` reads the whole
 * catalogue; a session id reads that run and fills in its archive on the way
 * through, so a later export of it is cheap.
 */
async function handleExtract(sessionId, outputPath, opts = {}) {
  const fromInstance = Boolean(opts.instance);

  if (!fromInstance && !sessionId) {
    throw new Error(
      'Please specify what to extract: aica extract <sessionId> [outputPath], or aica extract --instance [outputPath]'
    );
  }

  const target = fromInstance ? 'instance' : sessionId;
  const resolvedPath = packagePath(
    fromInstance ? sessionId : outputPath,
    `aica-extract-${target}`
  );

  console.log(
    fromInstance
      ? `Extracting a package from ${LIFERAY_URL} to: ${resolvedPath}...`
      : `Extracting media for ${sessionId} from ${LIFERAY_URL} to: ${resolvedPath}...`
  );
  console.log(
    '   This reads the instance over the network, one request per attachment.'
  );

  const { buffer, headers } = await nativeDownload(
    `${MICROSERVICE_URL}/api/v1/extract-commerce-bundle`,
    {
      method: 'POST',
      payload: {
        ...buildConnectionPayload(),
        source: fromInstance ? 'instance' : 'session',
        ...(fromInstance ? {} : { sessionId }),
      },
    }
  );

  fs.writeFileSync(resolvedPath, buffer);
  console.log(`\n🟢 Package written to disk! (${buffer.length} bytes)`);

  const counts = reportPackageCounts(headers);

  if (counts.incomplete) {
    // A promotion built from this package would land products that cannot be
    // sold. A script should stop here rather than carry on to the import.
    process.exitCode = 1;
  }
}

async function handleImport(inputPath) {
  if (!inputPath) {
    throw new Error(
      'Please specify a dataset (.json) or package (.aicap) to import (aica import <inputPath>)'
    );
  }

  const resolvedPath = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Dataset file not found at: ${resolvedPath}`);
  }

  const bytes = fs.readFileSync(resolvedPath);
  // The same check the route makes, on the local file header rather than the
  // name, so a renamed package is still recognised - and so the two cannot
  // disagree about what is being sent.
  const isPackage =
    bytes.length > 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);

  if (!isPackage) {
    // Fails here rather than at the far end, where a malformed dataset is a
    // 400 with a parse error and no mention of the file it came from.
    try {
      JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      throw new Error(
        `${resolvedPath} is neither a dataset package nor valid JSON: ${error.message}`
      );
    }
  }

  console.log(
    `Uploading ${isPackage ? 'package' : 'dataset'} (${bytes.length} bytes) to ${LIFERAY_URL}...`
  );

  if (isPackage) {
    console.log('   Media travels with it and is attached as part of the run.');
  }

  // Multipart rather than a JSON body: a package is a zip, and the route
  // detects one by its header. Sending it as a field would make every
  // promotion a dataset with no pictures.
  const res = await nativeUpload(
    `${MICROSERVICE_URL}/api/v1/import-commerce-data`,
    buildConnectionPayload(),
    { bytes, field: 'importFile', filename: path.basename(resolvedPath) }
  );

  if (!res.success || !res.sessionId) {
    throw new Error(res.error || 'Failed to submit dataset import workflow.');
  }

  console.log(`\n🚀 Import Scaffolding Started! Session ID: ${res.sessionId}`);
  await pollProgress(res.sessionId);
}

async function handleConfig(subCommand, arg1, extraArgs) {
  const configToken = parseControlOptions(extraArgs || []).token;

  if (!subCommand || !['get', 'set'].includes(subCommand)) {
    throw new Error(
      'Usage: aica config <get | set> [filePath | --key <name> --value <val>]'
    );
  }

  const credentials = buildConnectionPayload();

  if (subCommand === 'get') {
    console.log(
      'Retrieving active configuration parameters from microservice...'
    );

    // 1. Fetch AI config & batch sizes in parallel
    const [aiConfig, batchSizes] = await Promise.all([
      nativePost(`${MICROSERVICE_URL}/api/v1/config/ai`, credentials),
      nativePost(`${MICROSERVICE_URL}/api/v1/config/batch-sizes`, credentials),
    ]);

    const result = {
      config: aiConfig.config || {},
      generationConfig: aiConfig.generationConfig || {},
      batchSizes: batchSizes.batchSizes || {},
    };

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subCommand === 'set') {
    if (!arg1) {
      throw new Error(
        'Please specify a configuration JSON file path, or --key <name> --value <val>'
      );
    }

    let savePayload;

    // A. Single Key Setter Flow: --key <name> --value <val>
    if (arg1 === '--key') {
      const keyIndex = extraArgs.indexOf('--key');
      const valIndex = extraArgs.indexOf('--value');
      const keyName = extraArgs[keyIndex + 1];
      const valString = extraArgs[valIndex + 1];

      if (!keyName || !valString) {
        throw new Error('Usage: aica config set --key <name> --value <val>');
      }

      console.log(`Updating single property "${keyName}"...`);

      // Retrieve current config first
      const current = await nativePost(
        `${MICROSERVICE_URL}/api/v1/config/ai`,
        credentials
      );
      const config = current.config || {};
      const genConfig = current.generationConfig || {};

      // Parse primitive types dynamically
      let typedVal = valString;
      if (valString === 'true') typedVal = true;
      else if (valString === 'false') typedVal = false;
      else if (/^\d+$/.test(valString)) typedVal = parseInt(valString, 10);

      // Determine where the key belongs (standard mapping)
      const configKeys = [
        'liferayUrl',
        'clientId',
        'clientSecret',
        'localeCode',
        'languageId',
        'currencyCode',
        'selectedLanguages',
        'aiModel',
        'batchSize',
        'pollingDelay',
        'pollingRetries',
        'demoMode',
      ];
      if (configKeys.includes(keyName)) {
        config[keyName] = typedVal;
      } else {
        genConfig[keyName] = typedVal;
      }

      savePayload = {
        ...credentials,
        config,
        generationConfig: genConfig,
      };
    }
    // B. Bulk Import/JSON File Setter Flow
    else {
      const filePath = path.resolve(process.cwd(), arg1);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Configuration file not found at: ${filePath}`);
      }

      console.log(`Reading configuration from: ${filePath}...`);
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      // Rehydrate required nested structure dynamically
      savePayload = {
        ...credentials,
        config: parsed.config || parsed,
        generationConfig: parsed.generationConfig || parsed,
      };
    }

    // Save configuration parameters to microservice
    const saveRes = await nativePost(
      `${MICROSERVICE_URL}/api/v1/config/save`,
      savePayload,
      { token: adminToken({ token: configToken }, 'aica config set') }
    );
    if (!saveRes.success) {
      throw new Error(
        saveRes.error || 'Failed to save configuration parameters.'
      );
    }

    console.log(
      '\n🟢 Configuration updated successfully! Connection maintained.'
    );
  }
}

// --- 6. Helper APIs, Poller, and REST utilities ---

function buildConnectionPayload() {
  const payload = {
    liferayUrl: LIFERAY_URL,
    localeCode: 'en-US',
    languageId: 'en_US',
    currencyCode: 'USD',
  };

  if (process.env.LIFERAY_API_CLIENT_ID) {
    payload.clientId = process.env.LIFERAY_API_CLIENT_ID;
  }
  if (process.env.LIFERAY_API_CLIENT_SECRET) {
    payload.clientSecret = process.env.LIFERAY_API_CLIENT_SECRET;
  }

  return payload;
}

async function pollProgress(sessionId) {
  const isTTY = process.stdout.isTTY;
  let finished = false;

  while (!finished) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const res = await nativeGet(
        `${MICROSERVICE_URL}/api/v1/workflows/sessions/${sessionId}/status`
      );
      if (!res || !res.session) {
        throw new Error('Failed to fetch status updates.');
      }

      const session = res.session;
      const progress = session.overall_progress || 0;
      const step = session.active_step_key || 'polling';
      const status = session.status;

      // Format clean progress indicator text
      const progressDetails = `(${step} - Products: ${session.completed_products_count || 0}/${session.target_products_count || 0})`;

      if (isTTY) {
        // Draw real-time moving ASCII progress bar
        const width = 20;
        const filledLength = Math.round((width * progress) / 100);
        const emptyLength = width - filledLength;
        const bar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);
        process.stdout.write(`\r⏳ [${bar}] ${progress}% ${progressDetails}`);
      } else {
        // Single line log print fallback for non-TTY (like Playwright/CI logs)
        console.log(`⏳ Progress: ${progress}% ${progressDetails}`);
      }

      if (status === 'COMPLETED' || progress >= 100) {
        finished = true;
        console.log(
          `\n\n🎉 Success! Session successfully completed with 100% progress!`
        );
      } else if (status === 'FAILED') {
        finished = true;
        throw new Error(
          session.terminal_error || 'Generation session failed on the backend.'
        );
      }
    } catch (e) {
      console.log(`\n❌ Polling encountered error: ${e.message}`);
      throw e;
    }
  }
}

async function nativePost(url, payload, { token } = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * A response that is a file, with the headers that describe it.
 *
 * `nativeGet` and `nativePost` parse JSON, which turns a package into a string
 * of replacement characters. The headers matter as much as the bytes here: for
 * an export or an extract they carry what the package does and does not
 * contain.
 */
async function nativeDownload(url, { method = 'GET', payload } = {}) {
  const res = await fetch(url, {
    method,
    ...(payload
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    let message = text;

    try {
      message = JSON.parse(text).error || text;
    } catch {
      // Not JSON. The body, whatever it is, beats the status code alone.
    }

    throw new Error(`HTTP ${res.status}: ${message}`);
  }

  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    headers: res.headers,
  };
}

/** A multipart upload, built from the runtime's own FormData - no dependency. */
async function nativeUpload(url, fields, { bytes, field, filename }) {
  const form = new FormData();

  Object.entries(fields).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    form.append(
      key,
      typeof value === 'object' ? JSON.stringify(value) : String(value)
    );
  });

  form.append(field, new Blob([bytes]), filename);

  const res = await fetch(url, { method: 'POST', body: form });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json();
}

async function nativeGet(url) {
  const res = await fetch(url, {
    method: 'GET',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function handleReindex(className, opts) {
  if (opts.docker) {
    await runDockerReindex(className);
    return;
  }

  // Built so the path appears literally rather than assembled from a fragment:
  // tests/surfaceParity.test.cjs reads these sources to find an endpoint no
  // surface can reach, and a path spelled `/api/v1/${endpoint}` is invisible
  // to it - which would have read as "the CLI cannot reindex" when it can.
  const endpoint = className
    ? `/api/v1/reindex/${className}`
    : '/api/v1/reindex';
  console.log(`Triggering search reindexing for: ${className || 'All'}`);

  const payload = {
    ...buildConnectionPayload(),
  };

  try {
    const res = await nativePost(`${MICROSERVICE_URL}${endpoint}`, payload);

    if (!res.success) {
      throw new Error(res.error || 'Failed to trigger reindexing.');
    }

    console.log(
      `\n✅ Reindexing trigger successful! Response: ${res.message || 'Scheduled'}`
    );
  } catch (error) {
    if (!opts.api) {
      console.warn(
        `⚠️ Microservice connection failed (${error.message}). Attempting local Docker fallback...`
      );
      await runDockerReindex(className);
    } else {
      throw error;
    }
  }
}

async function runDockerReindex(className) {
  console.log(
    `\n🐳 Executing Option 2: Local Docker Reindex for ${className || 'All'}...`
  );
  const { execSync } = require('child_process');
  try {
    execSync('docker ps', { stdio: 'ignore' });
  } catch (e) {
    throw new Error(
      'Docker is not running or accessible in this environment. Cannot run Docker reindex.'
    );
  }

  try {
    const liferayContainer = execSync(
      'docker ps --filter "name=liferay" --format "{{.Names}}"'
    )
      .toString()
      .trim()
      .split('\n')[0];
    if (!liferayContainer) {
      throw new Error('No active Liferay container found.');
    }

    console.log(`Found active Liferay container: ${liferayContainer}`);
    console.log('Invoking Liferay Docker Manager (LDM) reindex controller...');
    execSync('ldm reindex -y', { stdio: 'inherit' });
    console.log(
      '\n✅ Triggered reindex in LDM (immediate if container is running, otherwise scheduled for next startup).'
    );
  } catch (error) {
    throw new Error(`Docker reindex execution failed: ${error.message}`);
  }
}

/** Left-pads the description column; long flag lists just push it right. */
function padFlag(text, width = 40) {
  return text.length >= width ? `${text} ` : text.padEnd(width);
}

function formatGenerateOptionUsage(opt) {
  const names = [opt.flag, ...(opt.aliases || [])];

  if (opt.type === 'boolean') {
    return names.map((name) => `--[no-]${name}`).join(' / ');
  }

  const placeholder =
    opt.placeholder || { integer: 'N', list: '<a,b,c>' }[opt.type] || '<value>';

  return names.map((name) => `--${name} ${placeholder}`).join(' / ');
}

function formatGenerateOptionHelp(opt) {
  const defaultSuffix = opt.default === undefined ? '' : ` [${opt.default}]`;
  return `${opt.help}${defaultSuffix}`;
}

/**
 * Every generate flag, one line each, read off GENERATE_OPTIONS rather than
 * typed here - the same table `parseGenerateArgs` and `buildGeneratePayload`
 * read, so a flag `--help` does not mention is a flag that does not exist.
 */
function generateOptionsHelpLines() {
  return GENERATE_OPTIONS.map(
    (opt) =>
      `  ${padFlag(formatGenerateOptionUsage(opt))}${formatGenerateOptionHelp(opt)}`
  ).join('\n');
}

function printHelp() {
  console.log(`
========================================================================
 Liferay AI Commerce Accelerator (AICA) - Headless Command Line Interface
========================================================================

Usage: aica <command> [options]

Commands:
  connect                                Handshake with target DXP server
  generate [--demo] [--products N]       Trigger a new data generation
  delete [--all | --selected]            Tear down and delete generated data
  export <sessionId> [outputPath]        Export a completed dataset as JSON, without media
  export <sessionId> --bundle [path]     Export it as a package (.aicap) carrying its media
  extract <sessionId> [outputPath]       Read a run's media back from the live instance
  extract --instance [outputPath]        Read the whole catalogue from the live instance
  import <inputPath>                     Import a dataset (.json) or package (.aicap)
  config get                             Retrieve active parameters from microservice
  config set <filePath>                  Import parameters from a JSON configuration file
  config set --key <name> --value <val>  Update a single configuration key dynamically
  reindex [className]                    Trigger search reindexing (defaults to all)

Options:
  --bundle / --with-media                Export a package (.aicap) rather than a JSON dataset
  --instance                             Extract the whole catalogue rather than one run
  --docker                               Force Option 2: local Docker/LDM reindex trigger
  --api                                  Force Option 1: REST API reindex trigger via microservice
${generateOptionsHelpLines()}
  -y / --yes / --non-interactive         Bypass interactive prompts and exit on missing config
  --all                                  Perform global deletions
  --selected                             Perform selected channel deletions

Generate inputs resolved elsewhere rather than exposed as flags (see
WITHHELD_GENERATE_KEYS in aica-cli.cjs for the reason against each):
clientId, clientSecret, liferayUrl and authMethod come from the same '.env'
cascade every command already uses; microserviceUrl and chunkSizes have no
flat CLI shape.

Moving a dataset between instances:
  - 'export --bundle' reads the media this service already wrote to disk. It
    calls no Liferay and needs no credentials, so it is the cheap route.
  - 'extract' reads a live instance instead, one request per attachment. Use it
    when the media was never held locally, and note that extracting a session
    fills in its archive, so a later export of it is cheap.
  - Both print what the package contains. A non-zero shortfall means it carries
    less than its source, and 'extract' exits non-zero when products are
    missing a field the schema requires.

Convention Rules:
  - Scans current directory cascading up for standard local '.env' parameters.
  - Defaults to local microservice running at port 3001.
`);
}

// Only runs the CLI when executed directly (`node aica-cli.cjs ...` or the
// `aica` bin) - not when `require`d, which is how the option-coverage and
// argument-parser tests reach GENERATE_OPTIONS/parseGenerateArgs without
// triggering process.exit or a real command dispatch. See #735.
if (require.main === module) {
  main();
}

module.exports = {
  GENERATE_OPTIONS,
  WITHHELD_GENERATE_KEYS,
  adminToken,
  buildGeneratePayload,
  parseControlOptions,
  parseGenerateArgs,
};
