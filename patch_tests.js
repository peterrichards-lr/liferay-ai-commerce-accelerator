const fs = require('fs');

const promoTestFile =
  '/Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/client-extensions/ai-commerce-accelerator-microservice/tests/PromoGenerator.test.cjs';
let promoData = fs.readFileSync(promoTestFile, 'utf8');
promoData = promoData.replace(
  /createPriceList: vi\.fn\(\)\.mockResolvedValue\(\{ id: 500 \}\),/g,
  'createPriceList: vi.fn().mockResolvedValue({ id: 500 }),\n        createPriceEntriesBatch: vi.fn().mockResolvedValue({ count: 1 }),'
);
fs.writeFileSync(promoTestFile, promoData);

const productGeneratorTestFile =
  '/Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/client-extensions/ai-commerce-accelerator-microservice/tests/productGenerator.test.cjs';
let productData = fs.readFileSync(productGeneratorTestFile, 'utf8');
productData = productData.replace(
  /submitBatch: vi\.fn\(\)\.mockImplementation\(\(sessionId, key, domain, op, cb\) => cb\('test-erc'\)\),/g,
  'submitBatch: vi.fn().mockImplementation((sessionId, key, domain, op, cb) => cb("test-erc")),\n        createPriceEntriesBatch: vi.fn().mockResolvedValue({ count: 1 }),'
);
fs.writeFileSync(productGeneratorTestFile, productData);

const promoGenFile =
  '/Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/client-extensions/ai-commerce-accelerator-microservice/generators/PromoGenerator.cjs';
let promoGenData = fs.readFileSync(promoGenFile, 'utf8');
promoGenData = promoGenData.replace(
  /this\.liferay\.rest\.createPriceEntriesBatch/g,
  'this.liferay.createPriceEntriesBatch'
);
fs.writeFileSync(promoGenFile, promoGenData);

const prodGenFile =
  '/Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/client-extensions/ai-commerce-accelerator-microservice/generators/productGenerator.cjs';
let prodGenData = fs.readFileSync(prodGenFile, 'utf8');
prodGenData = prodGenData.replace(
  /this\.liferay\.rest\.createPriceEntriesBatch/g,
  'this.liferay.createPriceEntriesBatch'
);
fs.writeFileSync(prodGenFile, prodGenData);
