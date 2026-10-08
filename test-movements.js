const http = require('http');

const request = (method, path, data) => new Promise((resolve, reject) => {
  const req = http.request({
    hostname: 'localhost',
    port: 3000,
    path,
    method,
    headers: { 'Content-Type': 'application/json' }
  }, res => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(body) }));
  });
  if (data) req.write(JSON.stringify(data));
  req.end();
});

(async () => {
  console.log('1. Create product with stock 10');
  let prodRes = await request('POST', '/api/products', { name: 'Stock Test Product', basePrice: 10, stockQuantity: 10 });
  const prodId = prodRes.data.data.id;
  console.log('Created product:', prodId);

  console.log('2. Create ENTRY of 5');
  let mov1 = await request('POST', '/api/movements', { productId: prodId, type: 'ENTRY', quantity: 5, note: 'Entrada' });
  console.log('Movement created:', mov1.data);

  console.log('3. Verify product stock is 15');
  let getProd1 = await request('GET', '/api/products/' + prodId);
  console.log('Stock:', getProd1.data.data.stockQuantity);

  console.log('4. Create EXIT of 4');
  let mov2 = await request('POST', '/api/movements', { productId: prodId, type: 'EXIT', quantity: 4 });
  console.log('Movement created:', mov2.data);

  console.log('5. Verify product stock is 11');
  let getProd2 = await request('GET', '/api/products/' + prodId);
  console.log('Stock:', getProd2.data.data.stockQuantity);

  console.log('6. Try EXIT of 20');
  let mov3 = await request('POST', '/api/movements', { productId: prodId, type: 'EXIT', quantity: 20 });
  console.log('Result:', mov3.data);

  console.log('8. Verify stock is still 11');
  let getProd3 = await request('GET', '/api/products/' + prodId);
  console.log('Stock:', getProd3.data.data.stockQuantity);

  console.log('10. Retrieve movements');
  let getMovs = await request('GET', '/api/movements?productId=' + prodId);
  console.log('Movements count:', getMovs.data.data.length);
  
  console.log('11. Try deleting product');
  let delProd = await request('DELETE', '/api/products/' + prodId);
  console.log('Delete result:', delProd.data);

  console.log('13. Verify product and movements exist');
  let getProd4 = await request('GET', '/api/products/' + prodId);
  console.log('Product exists:', !!getProd4.data.data);
  let getMovs2 = await request('GET', '/api/movements?productId=' + prodId);
  console.log('Movements count:', getMovs2.data.data.length);

  console.log('15. Verify GET /health');
  let health = await request('GET', '/health');
  console.log('Health:', health.data);
})();
