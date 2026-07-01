module.exports = {
  // Deletion
  resetCatalogConfiguration: require('./resetCatalogConfiguration.cjs'),
  deleteOrders: require('./deleteOrders.cjs'),
  deleteWarehouses: require('./deleteWarehouses.cjs'),
  deleteWarehouseItems: require('./deleteWarehouseItems.cjs'),
  deleteAccounts: require('./deleteAccounts.cjs'),
  deleteAccountGroups: require('./deleteAccountGroups.cjs'),
  deleteProducts: require('./deleteProducts.cjs'),
  deleteProductOptions: require('./deleteProductOptions.cjs'),
  deleteProductSpecifications: require('./deleteProductSpecifications.cjs'),
  deletePriceLists: require('./deletePriceLists.cjs'),
  deletePromotions: require('./deletePromotions.cjs'),
  deleteSpecifications: require('./deleteSpecifications.cjs'),
  deleteOptions: require('./deleteOptions.cjs'),
  deleteOptionCategories: require('./deleteOptionCategories.cjs'),
  deleteProductRelatedEntities: require('./deleteProductRelatedEntities.cjs'),

  // Generation
  createAccounts: require('./createAccounts.cjs'),
  createPostalAddresses: require('./createPostalAddresses.cjs'),
  logNextStep: require('./logNextStep.cjs'),
  resolveEntities: require('./resolveEntities.cjs'),
};
