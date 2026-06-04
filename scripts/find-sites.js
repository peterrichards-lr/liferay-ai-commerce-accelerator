const https = require('https');

const options = {
  hostname: 'aica-e2e.local',
  port: 443,
  path: '/api/jsonws/group/get-user-sites',
  method: 'GET',
  rejectUnauthorized: false,
  headers: {
    Authorization:
      'Basic ' + Buffer.from('test@liferay.com:test').toString('base64'),
    Accept: 'application/json',
  },
};

const req = https.request(options, (res) => {
  console.log('Status:', res.statusCode);
  let data = '';
  res.on('data', (chunk) => (data += chunk));
  res.on('end', () => {
    console.log('Raw JSON Response:');
    console.log(data);
  });
});

req.on('error', (e) => console.error('Request failed:', e));
req.end();
