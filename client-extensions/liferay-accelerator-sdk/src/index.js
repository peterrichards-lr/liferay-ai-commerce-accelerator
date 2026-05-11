/**
 * @liferay/accelerator-sdk
 * Hardened foundation for Liferay accelerators.
 */

const { LiferayService } = require("./liferay/index.cjs");
const LiferayRestService = require("./liferay/rest.cjs");
const LiferayGraphQLService = require("./liferay/graphql.cjs");
const OAuthService = require("./liferay/oauth.cjs");
const ContractValidator = require("./services/contractValidator.cjs");
const GeneratedLiferayClient = require("./liferay/GeneratedLiferayClient.cjs");

// Utils
const liferayPaths = require("./utils/liferayPaths.cjs");
const liferayUtils = require("./utils/liferayUtils.cjs");
const constants = require("./utils/constants.cjs");
const misc = require("./utils/misc.cjs");

module.exports = {
  LiferayService,
  LiferayRestService,
  LiferayGraphQLService,
  OAuthService,
  ContractValidator,
  GeneratedLiferayClient,

  // Expose key utilities
  utils: {
    ...liferayPaths,
    ...liferayUtils,
    ...misc,
    constants,
  },

  version: "0.1.0",
};
