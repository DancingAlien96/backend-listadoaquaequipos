// Simple Express server to proxy WooCommerce API
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const multer = require('multer');
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

const JWT_SECRET = process.env.JWT_SECRET || 'aquaequipos_secret_2026';

// ── MongoDB connection ────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('MongoDB conectado');
    // Crear usuario admin por defecto si no existe ninguno
    const count = await User.countDocuments();
    if (count === 0) {
      await User.create({ username: 'admin', password: bcrypt.hashSync('admin123', 10), role: 'admin' });
      console.log('Usuario admin creado por defecto');
    }
    // Migración: asignar rol a usuarios que no lo tienen
    const sinRol = await User.countDocuments({ role: { $exists: false } });
    if (sinRol > 0) {
      await User.updateMany({ role: { $exists: false }, username: 'admin' }, { $set: { role: 'admin' } });
      await User.updateMany({ role: { $exists: false } }, { $set: { role: 'secretaria' } });
      console.log(`Migración: ${sinRol} usuario(s) actualizados con rol`);
    }
  })
  .catch(err => console.error('Error conectando MongoDB:', err));

// ── User model ────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'secretaria'], default: 'secretaria' },
});
const User = mongoose.model('User', UserSchema);

// ── JWT middleware ────────────────────────────────────────────
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

// ── Auth routes ───────────────────────────────────────────────

// Login
app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Faltan campos' });
    const user = await User.findOne({ username });
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    const token = jwt.sign({ id: user._id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, username: user.username, role: user.role });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Admin-only middleware
const adminMiddleware = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Solo administradores pueden gestionar usuarios' });
  next();
};

// Get users
app.get('/auth/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await User.find({}, '_id username role');
    res.json(users.map(u => ({ id: u._id, username: u.username, role: u.role })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create user
app.post('/auth/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Faltan campos' });
    if (await User.findOne({ username })) return res.status(400).json({ error: 'Usuario ya existe' });
    const validRole = ['admin', 'secretaria'].includes(role) ? role : 'secretaria';
    const user = await User.create({ username, password: bcrypt.hashSync(password, 10), role: validRole });
    res.json({ id: user._id, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete user
app.delete('/auth/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const count = await User.countDocuments();
    if (count === 1) return res.status(400).json({ error: 'No puedes eliminar el único usuario' });
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Media upload ──────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/media', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
    const wpUsername = process.env.WP_USERNAME;
    const wpAppPassword = process.env.WP_APP_PASSWORD;
    if (!wpUsername || !wpAppPassword) {
      return res.status(500).json({ error: 'Credenciales de WordPress no configuradas (WP_USERNAME / WP_APP_PASSWORD)' });
    }
    const auth = Buffer.from(`${wpUsername}:${wpAppPassword}`).toString('base64');
    const response = await fetch(`${process.env.WOOCOMMERCE_URL}/wp-json/wp/v2/media`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Disposition': `attachment; filename="${req.file.originalname}"`,
        'Content-Type': req.file.mimetype,
      },
      body: req.file.buffer,
    });
    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.message || 'Error subiendo imagen a WordPress' });
    res.json({ url: data.source_url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Product routes (protected) ────────────────────────────────

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

