// Simple Express server to proxy WooCommerce API
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api').default;

const app = express();
app.use(express.json());

const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',');
app.use(cors({ origin: allowedOrigins }));

const api = new WooCommerceRestApi({
  url: process.env.WOOCOMMERCE_URL,
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
  version: 'wc/v3',
});

// List products (with pagination and search)
app.get('/products', async (req, res) => {
  try {
    const { page = 1, per_page = 20, search = '' } = req.query;
    const params = { page, per_page };
    if (search) params.search = search;
    const response = await api.get('products', params);
    res.json({
      products: response.data,
      total: response.headers['x-wp-total'],
      totalPages: response.headers['x-wp-totalpages'],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create product
app.post('/products', async (req, res) => {
  try {
    const { data } = await api.post('products', req.body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit product
app.put('/products/:id', async (req, res) => {
  try {
    const { data } = await api.put(`products/${req.params.id}`, req.body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete product
app.delete('/products/:id', async (req, res) => {
  try {
    const { data } = await api.delete(`products/${req.params.id}`, { force: true });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Hide product (set status to draft)
app.patch('/products/:id/hide', async (req, res) => {
  try {
    const { data } = await api.put(`products/${req.params.id}`, { status: 'draft' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Show product (set status to publish)
app.patch('/products/:id/show', async (req, res) => {
  try {
    const { data } = await api.put(`products/${req.params.id}`, { status: 'publish' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
