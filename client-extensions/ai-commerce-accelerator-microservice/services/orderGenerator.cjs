const aiService = require('./aiService.cjs');
const liferayService = require('./liferayService.cjs');
const { logger } = require('../utils/logger.cjs');
const { v4: uuidv4 } = require('uuid');
const batchProcessor = require('../utils/batchProcessor.cjs');
const { MockDataGenerator } = require('./mockDataGenerator.cjs');
const { BatchPollingService } = require('./batchPollingService.cjs');

class OrderGenerator {
  constructor(wss = null) {
    this.aiService = aiService; // Make aiService accessible within the class
    this.mockDataGenerator = new MockDataGenerator();
    this.batchPollingService = new BatchPollingService(wss); // Initialize the polling service with WebSocket server
  }

  setWebSocketServer(wss) {
    this.batchPollingService.setWebSocketServer(wss);
  }

  async generateOrders(config, options) {
    const correlationId = config.correlationId || uuidv4();
    const useBatch = config.batchSize > 1 && options.orderCount > 1;

    logger.info('Starting order generation', {
      correlationId: correlationId,
      operation: 'generate-orders',
      orderCount: options.orderCount,
      useBatch: useBatch,
      batchSize: config.batchSize,
      pollingDelay: config.pollingDelay,
      pollingRetries: config.pollingRetries,
    });

    const results = {
      orders: [],
      created: 0,
      errors: [],
    };

    try {
      // Early validation for OpenAI key if not in demo mode
      if (!options.demoMode) {
        try {
          await this.aiService.getOpenAIClient();
          console.log('✓ OpenAI API key validated for order generation');
        } catch (error) {
          const errorMessage =
            'OpenAI API key not configured. Please set it in the AI Configuration object or enable demo mode.';
          console.error(
            '✗ OpenAI key validation failed for orders:',
            error.message
          );
          throw new Error(errorMessage);
        }
      }

      console.log('=== STARTING ORDER GENERATION ===');
      console.log(`Demo mode: ${options.demoMode}`);
      console.log(
        `Using ${useBatch ? 'batch' : 'individual'} operations (batch size: ${
          config.batchSize
        })`
      );
      console.log(`Retry enabled: ${config.pollingRetries > 0}`);
      console.log('Config:', {
        liferayUrl: config.liferayUrl,
        catalogId: config.catalogId,
        channelId: config.channelId,
        demoMode: options.demoMode,
        aiModel: config.aiModel,
        clientId: config.clientId ? '[PROVIDED]' : '[MISSING]',
        clientSecret: config.clientSecret ? '[PROVIDED]' : '[MISSING]',
      });
      console.log('Options:', options);

      // Get available products and accounts with retry logic
      const { products, accounts } = await this.getProductsAndAccountsWithRetry(
        config,
        options
      );

      console.log(
        `Found ${products.length} products and ${accounts.length} accounts`
      );

      let orderDataList;
      if (options.demoMode) {
        console.log(`Demo mode: Generating ${options.orderCount} mock orders`);
        orderDataList = this.mockDataGenerator.generateOrderData(
          options.orderCount
        );
        console.log(
          `Demo: Generated ${orderDataList.length} mock order data entries`
        );
      } else {
        console.log(
          `AI mode: Generating ${options.orderCount} orders using ${config.aiModel}`
        );
        orderDataList = await this.aiService.generateOrderData(
          options.orderCount,
          products,
          accounts,
          config.aiModel || 'gpt-4o'
        );
        console.log(`AI: Generated ${orderDataList.length} order data entries`);
      }

      // Create orders using appropriate method
      if (useBatch) {
        console.log(
          `Creating orders using batch processing with batch size: ${config.batchSize}`
        );
        await batchProcessor.processBatch(
          orderDataList,
          async (orderData) => {
            try {
              const createdOrder = await this.createSingleOrder(
                config,
                orderData,
                products,
                accounts
              );
              results.orders.push(createdOrder);
              results.created++;
              console.log(
                `✓ Created order: ${createdOrder.externalReferenceCode}`
              );
              return createdOrder;
            } catch (error) {
              console.error(
                `Failed to create order ${orderData.externalReferenceCode}:`,
                error.message
              );
              results.errors.push({
                externalReferenceCode: orderData.externalReferenceCode,
                error: error.message,
              });
              throw error;
            }
          },
          config.batchSize
        );
      } else {
        console.log(`Creating orders individually`);
        // Process orders one by one when batch size is 1
        for (const orderData of orderDataList) {
          try {
            const createdOrder = await this.createSingleOrder(
              config,
              orderData,
              products,
              accounts
            );
            results.orders.push(createdOrder);
            results.created++;
            console.log(
              `✓ Created order: ${createdOrder.externalReferenceCode}`
            );
          } catch (error) {
            console.error(
              `Failed to create order ${orderData.externalReferenceCode}:`,
              error.message
            );
            results.errors.push({
              externalReferenceCode: orderData.externalReferenceCode,
              error: error.message,
            });
          }
        }
      }

      console.log(
        `Order generation completed: ${results.created} created, ${results.errors.length} errors`
      );
      return results;
    } catch (error) {
      console.error('Order generation failed:', error);
      throw error;
    }
  }

  async createSingleOrder(
    config,
    orderData,
    availableProducts,
    availableAccounts
  ) {
    try {
      // Select a random account if not specified or invalid
      let accountId = orderData.accountId;
      if (!accountId || !availableAccounts.find((a) => a.id === accountId)) {
        const randomAccount =
          availableAccounts[
            Math.floor(Math.random() * availableAccounts.length)
          ];
        accountId = randomAccount.id;
      }

      console.log(
        `Selected account ID: ${accountId} from ${availableAccounts.length} available accounts`
      );

      // Ensure orderStatus is numeric (convert string to proper integer if needed)
      let orderStatus = orderData.orderStatus || this.getRandomOrderStatus();
      if (typeof orderStatus === 'string') {
        // Convert string status to numeric
        const statusMap = {
          open: 0,
          pending: 0,
          'in-progress': 1,
          processing: 1,
          shipped: 2,
          delivered: 10,
          completed: 10,
          cancelled: 15,
          canceled: 15,
        };
        orderStatus = statusMap[orderStatus.toLowerCase()] || 0;
      }

      // Prepare order data for Liferay API - only include valid properties
      const liferayOrder = {
        accountId: accountId, // Use the properly selected accountId
        channelId: parseInt(config.channelId), // Ensure numeric
        currencyCode: config.currencyCode,
        orderDate: orderData.orderDate || new Date().toISOString(),
        orderStatus: parseInt(orderStatus), // Ensure numeric
        externalReferenceCode:
          orderData.externalReferenceCode ||
          `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      };

      // Note: paymentStatus and addresses are not valid for order creation
      // They would be set via separate API calls after order creation

      // Create the order in Liferay
      const createdOrder = await liferayService.createOrder(
        config,
        liferayOrder
      );
      console.log(`Created order: ${createdOrder.externalReferenceCode}`);

      // TODO: Add order items
      // This would require the order items API endpoint
      // await this.addOrderItems(config, createdOrder.id, orderData.orderItems, availableProducts);

      return createdOrder;
    } catch (error) {
      console.error(
        `Failed to create order ${
          orderData.externalReferenceCode || 'unknown'
        }:`,
        error
      );
      throw error;
    }
  }

  getRandomOrderStatus() {
    // Use numeric order status codes that Liferay Commerce expects
    const statuses = [0, 1, 2, 10, 15]; // open, in-progress, pending, completed, cancelled
    return statuses[Math.floor(Math.random() * statuses.length)];
  }

  getRandomPaymentStatus() {
    // Payment status is typically handled separately in Liferay Commerce
    const statuses = [0, 1, 2, 3]; // pending, authorized, paid, failed
    return statuses[Math.floor(Math.random() * statuses.length)];
  }

  async getProductsAndAccountsWithRetry(config, options) {
    for (let attempt = 0; attempt <= config.pollingRetries; attempt++) {
      try {
        console.log(
          `Fetching available products and accounts... (attempt ${
            attempt + 1
          }/${config.pollingRetries + 1})`
        );

        const products = await liferayService.getProducts(
          config,
          config.catalogId
        );
        const accounts = await liferayService.getAccounts(config);

        if (products.length === 0) {
          if (attempt < config.pollingRetries) {
            console.log(
              `No products found, retrying in ${config.pollingDelay}ms...`
            );
            await new Promise((resolve) =>
              setTimeout(resolve, config.pollingDelay)
            );
            continue;
          } else {
            throw new Error(
              'No products available. Please generate products first.'
            );
          }
        }

        if (accounts.length === 0) {
          if (attempt < config.pollingRetries) {
            console.log(
              `No accounts found, retrying in ${config.pollingDelay}ms...`
            );
            await new Promise((resolve) =>
              setTimeout(resolve, config.pollingDelay)
            );
            continue;
          } else {
            throw new Error(
              'No accounts available. Please generate accounts first.'
            );
          }
        }

        // Both products and accounts found
        return { products, accounts };
      } catch (error) {
        if (
          attempt < config.pollingRetries &&
          (error.message.includes('No products available') ||
            error.message.includes('No accounts available'))
        ) {
          console.log(
            `Dependency check failed, retrying in ${config.pollingDelay}ms... (${error.message})`
          );
          await new Promise((resolve) =>
            setTimeout(resolve, config.pollingDelay)
          );
          continue;
        }
        throw error;
      }
    }
  }

  async addOrderItems(config, orderId, orderItems, availableProducts) {
    try {
      for (const item of orderItems) {
        // Find the product by SKU or ID
        const product = availableProducts.find(
          (p) => p.sku === item.sku || p.id === item.productId
        );

        if (!product) {
          console.warn(
            `Product not found for order item: ${item.sku || item.productId}`
          );
          continue;
        }

        const orderItem = {
          productId: product.id,
          sku: product.sku,
          quantity: item.quantity || 1,
          unitPrice: item.unitPrice || 0,
          externalReferenceCode: `OI-${orderId}-${product.sku}-${Date.now()}`,
        };

        // TODO: Create order item using Liferay API
        // This would require the order items API endpoint
        console.log(
          `Would create order item: ${orderItem.sku} x ${orderItem.quantity}`
        );
      }
    } catch (error) {
      console.error(`Failed to add order items to order ${orderId}:`, error);
    }
  }
}

module.exports = OrderGenerator;
