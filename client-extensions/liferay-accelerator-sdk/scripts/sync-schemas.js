/**
 * Liferay Schema Sync Utility
 *
 * This script pulls the authoritative OpenAPI and GraphQL schemas from a
 * running Liferay instance. This ensures the SDK stays aligned with
 * any custom objects, dynamic APIs, or Liferay version upgrades.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Target directory for schemas
const SCHEMA_DIR = path.join(__dirname, '../api-schemas');

/**
 * Basic ENV loader for scripts
 */
function loadEnv() {
  const envPath = path.join(__dirname, '../../../.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const value = parts
        .slice(1)
        .join('=')
        .trim()
        .replace(/^"(.*)"$/, '$1');
      process.env[key] = value;
    }
  });
}

/**
 * List of core Liferay APIs to sync
 */
const APIS = [
  {
    name: 'headless-admin-user-v1.0',
    path: '/o/headless-admin-user/v1.0/openapi.json',
  },
  {
    name: 'headless-commerce-admin-catalog-v1.0',
    path: '/o/headless-commerce-admin-catalog/v1.0/openapi.json',
  },
  {
    name: 'headless-commerce-admin-order-v1.0',
    path: '/o/headless-commerce-admin-order/v1.0/openapi.json',
  },
  {
    name: 'headless-commerce-admin-pricing-v2.0',
    path: '/o/headless-commerce-admin-pricing/v2.0/openapi.json',
  },
  {
    name: 'headless-commerce-admin-inventory-v1.0',
    path: '/o/headless-commerce-admin-inventory/v1.0/openapi.json',
  },
  {
    name: 'headless-admin-address-v1.0',
    path: '/o/headless-admin-address/v1.0/openapi.json',
  },
  {
    name: 'headless-delivery-v1.0',
    path: '/o/headless-delivery/v1.0/openapi.json',
  },
  {
    name: 'headless-batch-engine-v1.0',
    path: '/o/headless-batch-engine/v1.0/openapi.json',
  },
];

async function syncREST(baseUrl, auth) {
  console.log(`\n--- Syncing REST Schemas from ${baseUrl} ---`);

  if (!fs.existsSync(SCHEMA_DIR)) {
    fs.mkdirSync(SCHEMA_DIR, { recursive: true });
  }

  for (const api of APIS) {
    const url = `${baseUrl}${api.path}`;
    try {
      console.log(`Fetching ${api.name}...`);
      const response = await axios.get(url, { auth });

      const fileName = `${api.name}-openapi.json`;
      const filePath = path.join(SCHEMA_DIR, fileName);

      fs.writeFileSync(filePath, JSON.stringify(response.data, null, 2));
      console.log(`✓ Saved to ${fileName}`);
    } catch (error) {
      console.error(`✗ Failed to fetch ${api.name}: ${error.message}`);
    }
  }
}

async function syncGraphQL(baseUrl, auth) {
  console.log(`\n--- Syncing GraphQL Schema from ${baseUrl} ---`);

  const url = `${baseUrl}/o/graphql`;
  const introspectionQuery = `
    query IntrospectionQuery {
      __schema {
        queryType { name }
        mutationType { name }
        subscriptionType { name }
        types {
          ...FullType
        }
        directives {
          name
          description
          locations
          args {
            ...InputValue
          }
        }
      }
    }

    fragment FullType on __Type {
      kind
      name
      description
      fields(includeDeprecated: true) {
        name
        description
        args {
          ...InputValue
        }
        type {
          ...TypeRef
        }
        isDeprecated
        deprecationReason
      }
      inputFields {
        ...InputValue
      }
      interfaces {
        ...TypeRef
      }
      enumValues(includeDeprecated: true) {
        name
        description
        isDeprecated
        deprecationReason
      }
      possibleTypes {
        ...TypeRef
      }
    }

    fragment InputValue on __InputValue {
      name
      description
      type { ...TypeRef }
      defaultValue
    }

    fragment TypeRef on __Type {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                  ofType {
                    kind
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await axios.post(
      url,
      { query: introspectionQuery },
      { auth }
    );

    const filePath = path.join(SCHEMA_DIR, 'liferay-graphql-schema.json');
    fs.writeFileSync(filePath, JSON.stringify(response.data, null, 2));
    console.log(
      `✓ Saved GraphQL introspection result to liferay-graphql-schema.json`
    );
  } catch (error) {
    console.error(`✗ Failed to fetch GraphQL schema: ${error.message}`);
  }
}

async function main() {
  loadEnv();

  const baseUrl = process.env.LIFERAY_API_URL || 'http://localhost:8080';
  const username = process.env.LIFERAY_API_USERNAME || 'test@liferay.com';
  const password = process.env.LIFERAY_API_PASSWORD || 'test';

  const auth = {
    username,
    password,
  };

  console.log(`Starting schema sync for ${baseUrl}...`);

  await syncREST(baseUrl, auth);
  await syncGraphQL(baseUrl, auth);

  console.log('\n--- Sync Complete ---');
}

main().catch((err) => {
  console.error('Fatal error during sync:', err);
  process.exit(1);
});
