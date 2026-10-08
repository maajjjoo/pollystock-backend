const http = require('http');

const postData = JSON.stringify({
  attributes: [
    { name: 'Color', dataType: 'OPTIONS', isRequired: true, options: '["Rojo", "Azul"]' },
    { name: 'Size', dataType: 'TEXT', isRequired: false }
  ]
});

const req = http.request('http://localhost:3000/api/attributes', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => console.log('POST valid attr:', body));
});

req.write(postData);
req.end();
