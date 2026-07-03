import { LiferayRestService } from '@liferay/accelerator-sdk';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.e2e' });

const config = {
  liferayUrl: process.env.LIFERAY_URL || 'http://localhost:8080',
  adminEmail: process.env.LIFERAY_ADMIN_EMAIL || 'test@liferay.com',
  adminPassword: process.env.LIFERAY_ADMIN_PASSWORD || 'test',
};

const service = new LiferayRestService({
  logger: {
    debug: () => {},
    info: console.log,
    warn: console.warn,
    error: console.error,
  },
});

async function run() {
  try {
    // Try to create a price entry with priceListExternalReferenceCode
    const entryData = {
      price: 10,
      active: true,
      skuExternalReferenceCode: 'MIN0001',
      externalReferenceCode: 'TEST-PE-123',
    };

    // Assume a price list 'TEST-PL' exists. We'll just see what error it throws.
    await service._post(
      config,
      '/o/headless-commerce-admin-pricing/v2.0/price-lists/by-externalReferenceCode/TEST-PL/price-entries',
      { ...entryData, priceListExternalReferenceCode: 'TEST-PL' },
      'test'
    );
    console.log('Success with priceListExternalReferenceCode');
  } catch (err) {
    console.error('Error with priceListExternalReferenceCode:', err.message);
  }

  try {
    const entryData2 = {
      price: 10,
      active: true,
      skuExternalReferenceCode: 'MIN0001',
      externalReferenceCode: 'TEST-PE-456',
    };
    await service._post(
      config,
      '/o/headless-commerce-admin-pricing/v2.0/price-lists/by-externalReferenceCode/TEST-PL/price-entries',
      entryData2,
      'test'
    );
    console.log('Success WITHOUT priceListExternalReferenceCode');
  } catch (err) {
    console.error('Error WITHOUT priceListExternalReferenceCode:', err.message);
  }
}

run();
