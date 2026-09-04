/**
 * Validates a generation request after normalisation.
 *
 * The generation route is multipart, so every field arrives as a string and
 * `validateInput` - which compares `typeof value` - would reject them all if
 * applied to the raw body. `buildConfigAndOptions` (HTTP) and
 * `getEffectiveConfigAndOptions` (MCP) already coerce, so validation runs on
 * their output instead. Both entry points are covered deliberately: the MCP
 * tool `aica_trigger_generation` reaches generation by its own path, so
 * validating only the HTTP route would leave a way around it.
 *
 * Ceilings come from the `generation-limits` configuration rather than from
 * constants. A limit that is absent means no ceiling, so an unreadable config
 * cannot start rejecting work that used to run.
 */
const { validateInput } = require('../middleware/securityMiddleware.cjs');
const {
  generateAccountsSchema,
  generateDataSchema,
  generateOrdersSchema,
} = require('./schemas.cjs');

const SCHEMAS = {
  accounts: generateAccountsSchema,
  data: generateDataSchema,
  orders: generateOrdersSchema,
};

/**
 * Resolves the three runtime inputs the schemas need. Each falls back to a
 * permissive value, so a configuration read failure degrades to "validate what
 * we can" rather than to a wall of rejections.
 */
async function resolveValidationContext(configService, requestConfig) {
  const [limits, batchSizes, modelOptions] = await Promise.all([
    Promise.resolve(configService?.getGenerationLimits?.(requestConfig)).catch(
      () => ({})
    ),
    Promise.resolve(configService?.getBatchSizes?.(requestConfig)).catch(
      () => []
    ),
    Promise.resolve(configService?.getAIModelOptions?.(requestConfig)).catch(
      () => ({})
    ),
  ]);

  return {
    limits: limits || {},
    batchSizes: Array.isArray(batchSizes) ? batchSizes : [],
    aiModelOptions: modelOptions?.aiModelOptions || [],
  };
}

/**
 * Drops `required` from every rule, leaving the value constraints intact.
 *
 * Requiredness is deliberately not enforced here. The schemas mark imageMode
 * and pdfMode required, but the MCP tool aica_trigger_generation does not send
 * them, and the callers have never had to satisfy these schemas - so turning
 * requiredness on would reject working requests. Checking the values that *are*
 * supplied is the part that can be switched on safely; requiredness needs a
 * survey of what each caller actually sends.
 */
function valuesOnly(schema) {
  return Object.fromEntries(
    Object.entries(schema).map(([field, rules]) => [
      field,
      { ...rules, required: false },
    ])
  );
}

/**
 * Returns an array of human-readable problems, empty when the request is fine.
 *
 * `flow` selects the schema: 'data' for a combined run, 'orders' or 'accounts'
 * for the standalone ones.
 */
function validateGenerationRequest(
  flow,
  { config = {}, options = {} },
  context = {}
) {
  const buildSchema = SCHEMAS[flow] || SCHEMAS.data;
  const schema = buildSchema(
    context.aiModelOptions || [],
    context.batchSizes || [],
    context.limits || {}
  );

  // The schemas describe a request as the caller sent it; normalisation splits
  // it into config and options, so recombine before checking.
  return validateInput({ ...config, ...options }, valuesOnly(schema));
}

module.exports = {
  resolveValidationContext,
  validateGenerationRequest,
};
