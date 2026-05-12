/**
 * @liferay/accelerator-sdk
 * Hardened foundation for Liferay accelerators.
 */

const { LiferayService } = require('./liferay/index.cjs');
const LiferayRestService = require('./liferay/rest.cjs');
const LiferayGraphQLService = require('./liferay/graphql.cjs');
const OAuthService = require('./liferay/oauth.cjs');
const ContractValidator = require('./services/contractValidator.cjs');
const GeneratedLiferayClient = require('./liferay/GeneratedLiferayClient.cjs');

// Workflow Engine
const BaseWorkflowService = require('./workflow/baseWorkflowService.cjs');
const BaseGenerator = require('./workflow/baseGenerator.cjs');
const PersistenceService = require('./services/persistenceService.cjs');
const BatchCallbackService = require('./services/batchCallbackService.cjs');
const BatchProcessorService = require('./services/batchProcessorService.cjs');

// Utils
const liferayPaths = require('./utils/liferayPaths.cjs');
const liferayUtils = require('./utils/liferayUtils.cjs');
const constants = require('./utils/constants.cjs');
const misc = require('./utils/misc.cjs');
const errorHandler = require('./utils/errorHandler.cjs');

module.exports = {
  LiferayService,
  LiferayRestService,
  LiferayGraphQLService,
  OAuthService,
  ContractValidator,
  GeneratedLiferayClient,

  // Workflow Engine
  BaseWorkflowService,
  BaseGenerator,
  PersistenceService,
  BatchCallbackService,
  BatchProcessorService,

  // Expose key utilities
  utils: {
    ...liferayPaths,
    ...liferayUtils,
    ...misc,
    ...errorHandler,
    constants,
  },

  version: '0.1.0',
};
