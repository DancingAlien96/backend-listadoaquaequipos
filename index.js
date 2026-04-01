// Simple Express server to proxy WooCommerce API
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
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

const USERS_FILE = path.join(__dirname, 'users.json');
const JWT_SECRET = process.env.JWT_SECRET || 'aquaequipos_secret_2026';

// Users file helpers
const loadUsers = () => {
  if (!fs.existsSync(USERS_FILE)) {
    const defaultUsers = [{ id: 1, username: 'admin', password: bcrypt.hashSync('admin123', 10) }];
    fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
    return defaultUsers;
  }
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
};
const saveUsers = (users) => fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

// JWT middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

// ── Auth routes ──────────────────────────────────────────────

// Login
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Faltan campos' });
  const users = loadUsers();
  const user = users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, username: user.username });
});

// Get users
app.get('/auth/users', authMiddleware, (req, res) => {
  const users = loadUsers().map(({ id, username }) => ({ id, username }));
  res.json(users);
});

// Create user
app.post('/auth/users', authMiddleware, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Faltan campos' });
  const users = loadUsers();
  if (users.find(u => u.username === username)) return res.status(400).json({ error: 'Usuario ya existe' });
  const newUser = { id: Date.now(), username, password: bcrypt.hashSync(password, 10) };
  users.push(newUser);
  saveUsers(users);
  res.json({ id: newUser.id, username: newUser.username });
});

// Delete user
app.delete('/auth/users/:id', authMiddleware, (req, res) => {
  let users = loadUsers();
  if (users.length === 1) return res.status(400).json({ error: 'No puedes eliminar el único usuario' });
  users = users.filter(u => u.id !== Number(req.params.id));
  saveUsers(users);
  res.json({ success: true });
});

// ── Product routes (protected) ───────────────────────────────

// List products
app.get('/products', authMiddleware, async (req, res) => {
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
app.post('/products', authMiddleware, async (req, res) => {
  try {
    const { data } = await api.post('products', req.body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit product
app.put('/products/:id', authMiddleware, async (req, res) => {
  try {
    const { data } = await api.put(`products/${req.params.id}`, req.body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete product
app.delete('/products/:id', authMiddleware, async (req, res) => {
  try {
    const { data } = await api.delete(`products/${req.params.id}`, { force: true });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Hide product
app.patch('/products/:id/hide', authMiddleware, async (req, res) => {
  try {
    const { data } = await api.put(`products/${req.params.id}`, { status: 'draft' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Show product
app.patch('/products/:id/show', authMiddleware, async (req, res) => {
  try {
    const { data } = await api.put(`products/${req.params.id}`, { status: 'publish' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

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
