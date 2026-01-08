module.exports = {
  // Deletion
  deleteOrders: require('./deleteOrders.cjs'),
  deleteWarehouses: require('./deleteWarehouses.cjs'),
  deleteAccounts: require('./deleteAccounts.cjs'),
  deleteProducts: require('./deleteProducts.cjs'),
  deletePriceLists: require('./deletePriceLists.cjs'),
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
