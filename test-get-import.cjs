const LiferayRestService = require('./client-extensions/liferay-accelerator-sdk/src/liferay/rest.cjs');

async function test() {
  const config = {
    url: 'http://localhost:8080',
    authMethod: 'basic',
    apiUsername: 'test@liferay.com',
    apiPassword: 'test'
  };

  const rest = new LiferayRestService(config);
  
  rest.ctx = {
    logger: {
      info: console.log,
      warn: console.log,
      error: console.error,
      debug: console.log
    }
  };

  const task = await rest.getImportTask(config, '107.0');
  console.log('Task Result:', JSON.stringify(task, null, 2));
}

test().catch(console.error);
