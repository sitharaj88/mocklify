// A tiny Express server that DECLARES routes — the "serves" side of an API
// surface. The scanner reads app.get/app.post/... route declarations here.
const express = require('express');

const app = express();
app.use(express.json());

const products = [
  { id: 1, name: 'Keyboard', price: 49.99 },
  { id: 2, name: 'Mouse', price: 24.5 },
];

app.get('/api/products', (req, res) => {
  res.json(products);
});

app.get('/api/products/:id', (req, res) => {
  const product = products.find((p) => p.id === Number(req.params.id));
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  res.json(product);
});

app.post('/api/products', (req, res) => {
  const product = { id: products.length + 1, ...req.body };
  products.push(product);
  res.status(201).json(product);
});

app.delete('/api/products/:id', (req, res) => {
  res.status(204).end();
});

app.listen(4000, () => console.log('backend-app listening on 4000'));
