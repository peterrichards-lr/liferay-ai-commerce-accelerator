/**
 * The provider declaration, imported rather than mirrored.
 *
 * This file used to have a twin on each of three tables - key families,
 * environment variables and image capability - edited by hand on both sides and
 * kept in step by tests that asserted the two agreed. Asserting agreement is a
 * weaker guarantee than having one copy, and it only ever fired after someone
 * had already got it wrong. See #635.
 *
 * The declaration lives in the microservice because that is the package with
 * the stricter packaging rule: its client-extension.yaml assembles only
 * CommonJS files and package.json from its own directory, so the file has to be
 * a .cjs inside it to be deployed at all. This extension ships as a pre-built
 * esbuild bundle, so it can read source from anywhere in the repository at
 * build time and carries no such constraint. esbuild inlines the CommonJS
 * module into the browser bundle; there is no runtime dependency on the
 * microservice package, and nothing here is re-declared.
 *
 * The registry is deliberately free of Node built-ins and of any reference to
 * the provider adapters so that it can be bundled for the browser.
 */
export {
  FAMILY_LABELS,
  IMAGE_CAPABLE_PROVIDERS,
  IMAGE_MODEL_PATTERNS,
  KEY_FAMILIES,
  KEY_PATTERNS,
  PROVIDERS,
  PROVIDER_ENV_VARS,
  PROVIDER_IDS,
  PROVIDER_KEY_FAMILY,
  PROVIDER_LABELS,
  PROVIDER_PATTERNS,
  TEXT_PROVIDERS,
  providerForFamily,
} from '../../../ai-commerce-accelerator-microservice/utils/providerRegistry.cjs';
