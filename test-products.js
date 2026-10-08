const http = require('http');

const request = (method, path, data) => new Promise((resolve, reject) => {
  const req = http.request({
    hostname: 'localhost',
    port: 3000,
    path,
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  }, res => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(body) }));
  });
  if (data) req.write(JSON.stringify(data));
  req.end();
});

(async () => {
  console.log('1. GET /api/products empty DB');
  let res = await request('GET', '/api/products');
  console.log(res.data);

  console.log('--- Setup: Get business and attributes to know IDs for testing dynamic attributes ---');
  let attrRes = await request('GET', '/api/attributes');
  const attrs = attrRes.data.data;
  let colorId = attrs.find(a => a.name === 'Color')?.id;
  
  console.log('2. POST /api/products valid product');
  let createPayload = {
    name: 'Test Product',
    basePrice: 15.5,
    stockQuantity: 10,
    sku: 'TS-123',
    dynamicAttributes: {}
  };
  if (colorId) {
    createPayload.dynamicAttributes[colorId] = 'Rojo'; // valid option
  }
  let prodRes = await request('POST', '/api/products', createPayload);
  console.log(prodRes.data);
  const prodId = prodRes.data.data.id;

  console.log('3. GET /api/products');
  res = await request('GET', '/api/products');
  console.log(res.data);

  console.log('4. GET /api/products/:id');
  res = await request('GET', '/api/products/' + prodId);
  console.log(res.data);

  console.log('5. PUT /api/products/:id');
  res = await request('PUT', '/api/products/' + prodId, { name: 'Updated Product', basePrice: 20 });
  console.log(res.data);

  console.log('6. POST /api/products invalid basePrice');
  res = await request('POST', '/api/products', { name: 'Invalid', basePrice: -5, stockQuantity: 10 });
  console.log(res.data);

  console.log('7. POST /api/products invalid dynamic attribute (missing required)');
  // Color is required (from previous test it was set to true)
  res = await request('POST', '/api/products', { name: 'Invalid', basePrice: 10, stockQuantity: 10, dynamicAttributes: {} });
  console.log(res.data);

  console.log('8. POST /api/products invalid OPTIONS value');
  let invalidPayload = { name: 'Invalid', basePrice: 10, stockQuantity: 10, dynamicAttributes: {} };
  if (colorId) {
    invalidPayload.dynamicAttributes[colorId] = 'Verde'; // invalid
  }
  res = await request('POST', '/api/products', invalidPayload);
  console.log(res.data);

  console.log('9. DELETE /api/products/:id');
  res = await request('DELETE', '/api/products/' + prodId);
  console.log(res.data);

})();
