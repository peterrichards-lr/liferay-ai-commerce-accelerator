const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const {
  SSEServerTransport,
} = require('@modelcontextprotocol/sdk/server/sse.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { WORKFLOW_STEPS, ERC_PREFIX } = require('../utils/constants.cjs');
const {
  resolveEffectiveLiferayConnection,
} = require('../utils/liferayEnv.cjs');
const { createERC } = require('../utils/misc.cjs');

const S = WORKFLOW_STEPS;

module.exports = (router, routeCtx) => {
  const {
    liferayService,
    logger,
    persistenceService,
    progressService,
    batchCallbackService,
    deleteCoordinatorService,
    healthService,
    oauthService,
  } = routeCtx;

  // Initialize MCP Server
  const mcpServer = new Server(
    { name: 'aica-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // Define Tools list
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'aica_get_status',
          description:
            'Get current connection details, DXP health, and local database statistics.',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'aica_list_sessions',
          description: 'Retrieve a list of past data generation sessions.',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'aica_get_session_logs',
          description: 'Retrieve the logs for a specific generation session.',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'The unique session ID to fetch logs for',
              },
            },
            required: ['sessionId'],
          },
        },
        {
          name: 'aica_trigger_generation',
          description: 'Trigger a new AI data generation run.',
          inputSchema: {
            type: 'object',
            properties: {
              productCount: {
                type: 'integer',
                description: 'Number of products to generate',
              },
              accountCount: {
                type: 'integer',
                description: 'Number of accounts to generate',
              },
              orderCount: {
                type: 'integer',
                description: 'Number of orders to generate',
              },
              generatePriceLists: {
                type: 'boolean',
                description: 'Whether to generate price list templates',
              },
              generateSkuVariants: {
                type: 'boolean',
                description: 'Whether to generate SKU variants dynamically',
              },
            },
          },
        },
        {
          name: 'aica_delete_session',
          description:
            'Perform a clean targeted teardown for a specific session ID.',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'The session ID to tear down',
              },
            },
            required: ['sessionId'],
          },
        },
        {
          name: 'aica_teardown_all',
          description:
            'Wipe all generated AICA commerce data from the DXP instance and reset the database.',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    };
  });

  // Helper to build effective configuration
  function getEffectiveConfigAndOptions(args) {
    const rawConfig = {
      authMethod: 'oauth2',
      correlationId: crypto.randomUUID(),
    };

    const {
      liferayUrl: effectiveUrl,
      clientId: effectiveClientId,
      clientSecret: effectiveClientSecret,
      isColocated,
    } = resolveEffectiveLiferayConnection(
      rawConfig,
      oauthService,
      persistenceService
    );

    const config = {
      ...rawConfig,
      liferayUrl: effectiveUrl,
      clientId: effectiveClientId,
      clientSecret: effectiveClientSecret,
      isColocated,
    };

    const options = {
      demoMode: false,
      productCount: parseInt(args.productCount, 10) || 0,
      accountCount: parseInt(args.accountCount, 10) || 0,
      orderCount: parseInt(args.orderCount, 10) || 0,
      sessionName: `mcp-generation-${Date.now()}`,
      brandName: 'MCP Brand',
      generateBulkPricing: false,
      generatePriceLists: args.generatePriceLists !== false,
      generateSkuVariants: args.generateSkuVariants !== false,
      generateSpecifications: true,
      generateTierPricing: false,
      createWarehouses: true,
      reuseExistingWarehouses: true,
      warehouseCount: 1,
      inventoryMin: 10,
      inventoryMax: 100,
      inventoryAssignmentRatio: 1.0,
      enableBackorders: false,
      backorderAssignmentRatio: 0.0,
      imageMode: 'none',
      pdfMode: 'none',
    };

    return { config, options };
  }

  // Define Tool Call handler
  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logger.info(`MCP Tool Call received: ${name}`, { arguments: args });

    try {
      switch (name) {
        case 'aica_get_status': {
          const status = await healthService.getDetailedHealth();
          return {
            content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
          };
        }

        case 'aica_list_sessions': {
          const sessions = await persistenceService.getAllSessions();
          return {
            content: [
              { type: 'text', text: JSON.stringify(sessions, null, 2) },
            ],
          };
        }

        case 'aica_get_session_logs': {
          const { sessionId } = args;
          const session = await persistenceService.getSession(sessionId);
          if (!session) {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `Session ${sessionId} not found in database`,
                },
              ],
            };
          }

          const logFile = logger.logFile;
          if (!fs.existsSync(logFile)) {
            return {
              isError: true,
              content: [
                { type: 'text', text: `Log file not found at ${logFile}` },
              ],
            };
          }

          const startTime = new Date(session.created_at);
          const endTime = session.updated_at
            ? new Date(session.updated_at)
            : null;
          const content = fs.readFileSync(logFile, 'utf8');
          const blocks = content.split(/^\{/m);

          const searchRes = [];
          for (const block of blocks) {
            if (!block.trim()) continue;
            const fullBlock = '{' + block;
            if (fullBlock.includes(sessionId)) {
              searchRes.push(fullBlock);
            } else {
              const match = fullBlock.match(/"timestamp":\s*"(.*?)"/);
              if (match) {
                const logTime = new Date(match[1]);
                if (
                  logTime >= startTime &&
                  (!endTime || logTime <= new Date(endTime.getTime() + 10000))
                ) {
                  searchRes.push(fullBlock);
                }
              }
            }
          }

          return { content: [{ type: 'text', text: searchRes.join('\n') }] };
        }

        case 'aica_trigger_generation': {
          const { config, options } = getEffectiveConfigAndOptions(args);

          // Resolve channel/catalog fallback
          if (!config.channelId || isNaN(config.channelId)) {
            const channels = await liferayService.getChannels(config);
            if (channels && channels.length > 0) {
              config.channelId = parseInt(channels[0].id, 10);
              config.siteGroupId = parseInt(channels[0].siteGroupId, 10);
            }
          }
          if (!config.catalogId || isNaN(config.catalogId)) {
            const catalogs = await liferayService.getCatalogs(config);
            if (catalogs && catalogs.length > 0) {
              config.catalogId = parseInt(catalogs[0].id, 10);
            }
          }

          const steps = [];
          let flowType = 'generate';
          const productSteps = [];
          const accountSteps = [];
          const orderSteps = [];

          if (options.productCount > 0) {
            productSteps.push({
              name: S.GENERATE_WAREHOUSE_DATA,
              type: 'sync',
            });
            productSteps.push({ name: S.CREATE_WAREHOUSES, type: 'sync' });
            productSteps.push({ name: S.RESOLVE_WAREHOUSE_IDS, type: 'sync' });
            productSteps.push({
              name: S.LINK_WAREHOUSE_CHANNELS,
              type: 'sync',
            });
            productSteps.push({ name: S.GENERATE_PRODUCT_DATA, type: 'sync' });
            productSteps.push({ name: S.ENSURE_CATEGORIES, type: 'sync' });
            productSteps.push({
              name: S.ENSURE_SPECIFICATION_CATEGORIES,
              type: 'sync',
            });
            productSteps.push({ name: S.ENSURE_SPECIFICATIONS, type: 'sync' });
            productSteps.push({ name: S.ENSURE_OPTIONS, type: 'sync' });
            productSteps.push({ name: S.CREATE_PRODUCTS, type: 'sync' });
            productSteps.push({ name: S.RESOLVE_PRODUCT_IDS, type: 'sync' });
            productSteps.push({ name: S.LINK_PRODUCT_OPTIONS, type: 'sync' });
            productSteps.push({ name: S.CREATE_PRODUCT_SKUS, type: 'sync' });
            productSteps.push({ name: S.RESOLVE_SKU_IDS, type: 'sync' });
            productSteps.push({ name: S.SYNC_DELAY_PRICING, type: 'sync' });
            productSteps.push({ name: S.GENERATE_PRICE_LISTS, type: 'sync' });
            if (options.generatePriceLists) {
              productSteps.push({
                name: S.UPDATE_CATALOG_CONFIG,
                type: 'sync',
              });
            }
            productSteps.push({
              type: 'parallel',
              steps: [
                { name: S.ATTACH_IMAGES, type: 'sync' },
                { name: S.ATTACH_PDFS, type: 'sync' },
                { name: S.UPDATE_INVENTORY, type: 'sync' },
              ],
            });
          }

          if (options.accountCount > 0) {
            accountSteps.push({ name: S.LOAD_COUNTRIES, type: 'sync' });
            accountSteps.push({ name: S.GENERATE_ACCOUNT_DATA, type: 'sync' });
            accountSteps.push({ name: S.CREATE_ACCOUNTS, type: 'sync' });
            accountSteps.push({ name: S.RESOLVE_ACCOUNT_IDS, type: 'sync' });
            accountSteps.push({
              name: S.CREATE_POSTAL_ADDRESSES,
              type: 'sync',
            });
            accountSteps.push({ name: S.SET_ADDRESS_DEFAULTS, type: 'sync' });
          }

          if (options.orderCount > 0) {
            orderSteps.push({ name: S.GENERATE_ORDER_DATA, type: 'sync' });
            orderSteps.push({ name: S.CREATE_ORDERS, type: 'sync' });
          }

          if (productSteps.length > 0 || accountSteps.length > 0) {
            steps.push({
              type: 'parallel',
              steps: [
                ...(productSteps.length > 0
                  ? [
                      {
                        name: 'subflow-products',
                        type: 'sequence',
                        steps: productSteps,
                      },
                    ]
                  : []),
                ...(accountSteps.length > 0
                  ? [
                      {
                        name: 'subflow-accounts',
                        type: 'sequence',
                        steps: accountSteps,
                      },
                    ]
                  : []),
              ],
            });
          }

          if (orderSteps.length > 0) {
            steps.push({
              name: 'subflow-orders',
              type: 'sequence',
              steps: orderSteps,
            });
          }

          if (
            options.accountCount > 0 &&
            !options.productCount &&
            !options.orderCount
          ) {
            flowType = 'accounts';
          } else if (
            options.orderCount > 0 &&
            !options.productCount &&
            !options.accountCount
          ) {
            flowType = 'orders';
          }

          if (steps.length === 0) {
            return {
              isError: true,
              content: [
                { type: 'text', text: 'No counts selected for generation.' },
              ],
            };
          }

          const sessionId = createERC(ERC_PREFIX.BATCH_SESSION);
          await persistenceService.createSession({
            sessionId,
            flowType,
            status: 'STARTED',
            currentSteps: [],
            correlationId: config.correlationId,
            sessionName: options.sessionName,
            context: { config, options, steps, generator: 'unified' },
          });

          progressService.sessionStarted({
            sessionId,
            flowType,
            correlationId: config.correlationId,
          });

          batchCallbackService._checkSessionCompletion(
            sessionId,
            config.correlationId
          );

          return {
            content: [
              {
                type: 'text',
                text: `Generation workflow successfully triggered. Session ID: ${sessionId}`,
              },
            ],
          };
        }

        case 'aica_delete_session': {
          const { sessionId } = args;
          const session = await persistenceService.getSession(sessionId);

          if (session && session.context) {
            const { config, options } = session.context;
            const channelId = config.channelId;
            const catalogId = config.catalogId;

            // Trigger targeted cleanup for channel & catalog
            const summary =
              await deleteCoordinatorService.runDeleteSelectedAndMonitor(
                config,
                options || {},
                { channelId, catalogId }
              );

            // Wipe database entries for the session
            persistenceService.db
              .prepare('DELETE FROM workflow_events WHERE session_id = ?')
              .run(sessionId);
            persistenceService.db
              .prepare('DELETE FROM workflow_batches WHERE session_id = ?')
              .run(sessionId);
            persistenceService.db
              .prepare('DELETE FROM workflow_sessions WHERE session_id = ?')
              .run(sessionId);

            return {
              content: [
                {
                  type: 'text',
                  text: `Targeted deletion triggered on DXP and database session ${sessionId} cleared. Summary: ${JSON.stringify(summary, null, 2)}`,
                },
              ],
            };
          } else {
            // Hard session database cleanup if context doesn't exist
            persistenceService.db
              .prepare('DELETE FROM workflow_events WHERE session_id = ?')
              .run(sessionId);
            persistenceService.db
              .prepare('DELETE FROM workflow_batches WHERE session_id = ?')
              .run(sessionId);
            const res = persistenceService.db
              .prepare('DELETE FROM workflow_sessions WHERE session_id = ?')
              .run(sessionId);

            return {
              content: [
                {
                  type: 'text',
                  text:
                    res.changes > 0
                      ? `Session ${sessionId} was not found on DXP (missing context), but has been pruned from the local database.`
                      : `Session ${sessionId} was not found in the database.`,
                },
              ],
            };
          }
        }

        case 'aica_teardown_all': {
          const { config, options } = getEffectiveConfigAndOptions({});
          const summary = await deleteCoordinatorService.runDeleteAndMonitor(
            config,
            options
          );

          return {
            content: [
              {
                type: 'text',
                text: `Full environment teardown started. Session ID: ${summary.sessionId}`,
              },
            ],
          };
        }

        default:
          throw new Error(`Tool not found: ${name}`);
      }
    } catch (err) {
      logger.error(`MCP Tool Execution Error (${name}):`, {
        error: err.message,
        stack: err.stack,
      });
      return {
        isError: true,
        content: [
          { type: 'text', text: `Failed to execute ${name}: ${err.message}` },
        ],
      };
    }
  });

  // SSE Connections Map & Routes
  let activeTransport = null;

  router.get('/mcp/sse', async (req, res) => {
    logger.info('Establish connection to SSE MCP transport endpoint');
    activeTransport = new SSEServerTransport('/api/v1/mcp/message', res);
    await mcpServer.connect(activeTransport);
  });

  router.post('/mcp/message', async (req, res) => {
    if (!activeTransport) {
      return res.status(400).send('No active SSE connection found');
    }
    await activeTransport.handlePostMessage(req, res);
  });
};
