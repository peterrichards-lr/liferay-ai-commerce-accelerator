#!/usr/bin/env node
/**
 * Measure how many distinct products a run actually delivers, and why.
 *
 * #825 asks for one comparison: the same brand and category set generated with
 * name-first on and off, delivered counts side by side. Nothing could produce
 * it. A full run needs Liferay, a catalog, a channel, OAuth and ten minutes of
 * import work - none of which touches the thing being measured.
 *
 * The plateau is settled inside `aiService.generateProductData`, before a
 * single product reaches Liferay: the model returns items, `createProductLedger`
 * discards the repeats, and the count that survives is the answer. So this
 * harness runs that method alone, against a stub config and disk-backed
 * prompts, and needs no Liferay at all.
 *
 * Demo mode cannot answer this question - it swaps the whole generator for
 * `mockDataGenerator`, whose products are distinct by construction and which
 * never calls a model.
 *
 *   node scripts/measure-product-yield.cjs --simulate
 *   node scripts/measure-product-yield.cjs --count 50 --chunk-size 5
 *   node scripts/measure-product-yield.cjs --arm on --provider anthropic \
 *        --model claude-sonnet-4-5 --chunk-size 10
 *
 * THIS SPENDS REAL MONEY unless --simulate is passed. A 50-product run is
 * roughly ten model calls per arm, plus one cheap naming call for the on arm.
 */
const fs = require('fs');
const path = require('path');

const { AIService } = require('../services/aiService.cjs');
const { PromptService } = require('../services/promptService.cjs');

const MICROSERVICE_DIR = path.join(__dirname, '..');

function parseArgs(argv) {
  const args = {
    arm: 'both',
    brand: 'Solara Moto',
    categories: [
      'Helmets',
      'Riding Boots',
      'Riding Jackets',
      'Gloves',
      'Body Armour and Protection',
      'Luggage and Panniers',
      'Engine and Exhaust Parts',
      'Tyres and Wheels',
      'Navigation and Electronics',
      'Maintenance and Care',
    ],
    chunkSize: 5,
    count: 50,
    model: null,
    provider: 'openai',
    // Simulated duplicate rate, used only by --simulate. 0.6 reproduces the
    // shape of the 2026-09-09 run closely enough to exercise the reporting.
    repeatRate: 0.6,
    simulate: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];

    if (arg === '--simulate') args.simulate = true;
    else if (arg === '--arm') args.arm = next();
    else if (arg === '--brand') args.brand = next();
    else if (arg === '--categories')
      args.categories = next()
        .split(',')
        .map((c) => c.trim());
    else if (arg === '--chunk-size') args.chunkSize = Number(next());
    else if (arg === '--count') args.count = Number(next());
    else if (arg === '--model') args.model = next();
    else if (arg === '--provider') args.provider = next();
    else if (arg === '--repeat-rate') args.repeatRate = Number(next());
    else if (arg === '--help' || arg === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }

  return args;
}

const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-5',
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o',
};

/**
 * The key is read from the same variables a run reads, so the harness and a
 * real run cannot disagree about which credential was used. `AI_API_KEY` is the
 * unconditional fallback; the provider-specific names are what `getAIKey`
 * consults once the provider is known.
 */
function resolveApiKey(provider) {
  const specific = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  }[provider];

  return specific || process.env.AI_API_KEY || null;
}

/**
 * A config that answers from disk instead of Liferay.
 *
 * `configService.getConfig` requires a Liferay client and throws without one,
 * which is the only reason a measurement needed an instance. Every value it
 * would have fetched is either on disk already or supplied here.
 */
function buildConfigStub({ apiKey, chunkSize, model, provider }) {
  return {
    getAIChunkSizes: async () => ({
      account: 10,
      order: 10,
      pricing: 10,
      product: chunkSize,
      warehouse: 10,
    }),
    getAIConfig: async () => ({
      defaultModel: model,
      mediaProvider: provider,
      provider,
      temperature: 0.7,
    }),
    getAIKey: async () => apiKey,
    getAIMediaKey: async () => apiKey,
    getAIModelOptions: async () => ({
      aiModelOptions: [],
      defaultModel: model,
    }),
    getAISchema: async (_requestConfig, schemaName) => {
      const file = path.join(
        MICROSERVICE_DIR,
        'generation-schemas',
        `${schemaName}.json`
      );
      return fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, 'utf8'))
        : null;
    },
  };
}

/**
 * Collects the per-chunk records the chunk loop emits.
 *
 * These are the fields added for #825 - `avoidListSize` against `kept` - and
 * reading them here rather than reimplementing the count is deliberate: the
 * harness must measure what a real run reports, not a parallel calculation
 * that could disagree with it.
 */
function buildLogger({ verbose }) {
  const chunks = [];
  const warnings = [];

  const record = (meta) => {
    if (meta && typeof meta.avoidListSize === 'number') chunks.push(meta);
  };

  return {
    chunks,
    warnings,
    debug: () => {},
    error: (message) => verbose && console.error('  ERROR', message),
    info: (message, meta) => {
      record(meta);
      if (verbose) console.error('  ', message);
    },
    trace: () => {},
    warn: (message, meta) => {
      warnings.push(message);
      record(meta);
      if (verbose) console.error('  WARN', message);
    },
  };
}

/**
 * Stands in for the model without calling one, so the harness itself can be
 * exercised for free. Returns a chunk that repeats earlier products at
 * `repeatRate` - the behaviour #825 recorded - unless the prompt carries
 * assigned names, in which case it elaborates them, which is what name-first
 * is betting the model will do.
 */
function buildSimulator({ repeatRate }) {
  const produced = [];
  let nameCall = 0;

  return async (task, promptContent, _requestConfig, _model, schemaName) => {
    if (task === 'names' || schemaName === 'names') {
      nameCall++;
      const wanted =
        Number((promptContent.match(/Produce (\d+) distinct/) || [])[1]) || 10;
      return {
        names: Array.from({ length: wanted }, (_, i) => ({
          category: 'Simulated',
          name: `Simulated Product ${nameCall}-${i + 1}`,
        })),
      };
    }

    const assigned = [...promptContent.matchAll(/^ {2}\d+\. (.+)$/gm)].map(
      (m) => m[1]
    );
    const wanted =
      Number((promptContent.match(/data for (\d+) /) || [])[1]) || 5;

    if (assigned.length > 0) {
      return assigned.map((name) => ({
        baseSku: name.toUpperCase().replace(/\s+/g, '-'),
        name: { en_US: name },
      }));
    }

    const items = [];
    for (let i = 0; i < wanted; i++) {
      const repeat = produced.length > 0 && Math.random() < repeatRate;
      const name = repeat
        ? produced[Math.floor(Math.random() * produced.length)]
        : `Invented Product ${produced.length + items.length + 1}`;
      items.push({
        baseSku: name.toUpperCase().replace(/\s+/g, '-'),
        name: { en_US: name },
      });
    }

    for (const item of items) {
      if (!produced.includes(item.name.en_US)) produced.push(item.name.en_US);
    }

    return items;
  };
}

async function runArm({ args, nameFirst }) {
  const model = args.model || DEFAULT_MODELS[args.provider];
  const apiKey = args.simulate
    ? 'sk-simulated-key-not-used'
    : resolveApiKey(args.provider);

  if (!apiKey) {
    console.error(
      `No API key. Set AI_API_KEY, or the provider-specific variable for ${args.provider}.`
    );
    process.exit(1);
  }

  const logger = buildLogger({ verbose: !args.simulate });
  const config = buildConfigStub({
    apiKey,
    chunkSize: args.chunkSize,
    model,
    provider: args.provider,
  });
  const ctx = { config, logger };
  ctx.prompt = new PromptService({ ...ctx, cache: new Map() });
  // PromptService resolves its directory against the working directory, so the
  // harness is runnable from anywhere rather than only from the microservice.
  ctx.prompt.baseDir = path.join(MICROSERVICE_DIR, 'prompts');

  const aiService = new AIService(ctx);
  await aiService.initializeSchemas();

  if (args.simulate) {
    aiService._chatJson = buildSimulator({ repeatRate: args.repeatRate });
  }

  const startedAt = Date.now();
  const products = await aiService.generateProductData(
    args.categories[0],
    args.count,
    { chunkSizes: { product: args.chunkSize }, nameFirstProducts: nameFirst },
    model,
    ['en-US'],
    { brandName: args.brand, categories: args.categories }
  );

  return {
    chunks: logger.chunks,
    delivered: products.length,
    elapsedMs: Date.now() - startedAt,
    nameFirst,
    warnings: logger.warnings,
  };
}

function reportArm(result, args) {
  console.log(`\n  name-first: ${result.nameFirst ? 'ON' : 'off'}`);
  console.log(`  delivered:  ${result.delivered} of ${args.count}`);
  console.log(`  elapsed:    ${(result.elapsedMs / 1000).toFixed(1)}s`);

  if (result.chunks.length === 0) {
    // These two cases look identical in the output and are not the same thing.
    // A harness that reads its numbers out of log metadata will silently print
    // an empty table the day a field is renamed, and an empty table reads as
    // "nothing to report" rather than "the measurement was lost".
    if (args.count <= args.chunkSize) {
      console.log(
        '  (no chunked generation - count did not exceed the chunk size)'
      );
    } else {
      console.log(
        `  NO PER-CHUNK RECORDS, though ${args.count} products over a chunk size of` +
          ` ${args.chunkSize} must have chunked.\n` +
          '  The instrumentation this reads has moved: it expects an info log whose\n' +
          '  metadata carries avoidListSize, kept, returned and distinctSoFar\n' +
          '  (aiService.generateProductData). The delivered count above still stands.'
      );
    }
    return;
  }

  console.log('\n  chunk  returned  kept  assigned  avoid-sent  distinct');
  console.log('  -----  --------  ----  --------  ----------  --------');
  for (const chunk of result.chunks) {
    // The ledger keeps every accepted product whether or not the avoid list is
    // sent, so `avoidListSize` is its size and not proof it reached the model.
    // Printing the number in the name-first arm would read as "the model was
    // told to avoid 15 things and repeated anyway", which is the opposite of
    // what happened - the two instructions are mutually exclusive.
    const avoidSent =
      chunk.assignedNames > 0 ? '-' : String(chunk.avoidListSize);
    console.log(
      `  ${String(chunk.chunkIndex).padStart(5)}  ${String(chunk.returned).padStart(8)}` +
        `  ${String(chunk.kept).padStart(4)}  ${String(chunk.assignedNames).padStart(8)}` +
        `  ${avoidSent.padStart(10)}  ${String(chunk.distinctSoFar).padStart(8)}`
    );
  }

  if (result.nameFirst) {
    console.log(
      '\n  avoid-sent is "-" because names were assigned: the avoid list and the\n' +
        '  assigned names are alternatives, so nothing was sent to avoid.'
    );
  }

  // Whether yield collapses gradually or falls off a cliff is the question
  // #825 could not answer, and it decides whether the avoid list has a workable
  // size or is the wrong shape of instruction outright.
  const dry = result.chunks.findIndex((chunk) => chunk.kept === 0);
  if (dry >= 0) {
    console.log(
      `\n  first chunk yielding nothing: #${result.chunks[dry].chunkIndex},` +
        ` with an avoid list of ${result.chunks[dry].avoidListSize}`
    );
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const arms = args.arm === 'both' ? [false, true] : [args.arm === 'on'];

  console.log('Product yield measurement (#825)');
  console.log(
    `  provider ${args.provider}, model ${args.model || DEFAULT_MODELS[args.provider]}`
  );
  console.log(
    `  ${args.count} products, chunk size ${args.chunkSize}, ${args.categories.length} categories`
  );
  if (args.simulate) {
    console.log(
      `  SIMULATED - no model is called, repeat rate ${args.repeatRate}`
    );
  }

  const results = [];
  for (const nameFirst of arms) {
    results.push(await runArm({ args, nameFirst }));
    reportArm(results[results.length - 1], args);
  }

  if (results.length === 2) {
    const [off, on] = results;
    console.log('\n  comparison');
    console.log(`    off: ${off.delivered} of ${args.count}`);
    console.log(`    on:  ${on.delivered} of ${args.count}`);
    console.log(
      `    difference: ${on.delivered - off.delivered >= 0 ? '+' : ''}${on.delivered - off.delivered}`
    );
    if (args.simulate) {
      console.log('\n    Simulated. Proves the harness, not the hypothesis.');
    }
  }
}

main().catch((error) => {
  console.error('\nFailed:', error?.message);
  if (process.env.DEBUG) console.error(error);
  process.exit(1);
});
