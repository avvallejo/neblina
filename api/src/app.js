const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Límite general — además de los límites específicos en /auth.
app.use(rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/usuarios', require('./routes/usuarios'));
app.use('/api/proveedores', require('./routes/proveedores'));
app.use('/api/materias-primas', require('./routes/materias'));
app.use('/api/productos', require('./routes/productos'));
app.use('/api/opciones', require('./routes/opciones'));
app.use('/api/recetas', require('./routes/recetas'));
app.use('/api/promociones', require('./routes/promociones'));
app.use('/api/gastos-fijos', require('./routes/gastosFijos'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/clientes', require('./routes/clientes'));
app.use('/api/turnos', require('./routes/turnos'));
app.use('/api/pedidos', require('./routes/pedidos'));
app.use('/api/pedido-items', require('./routes/pedidoItems'));
app.use('/api/mermas', require('./routes/mermas'));
app.use('/api/reportes', require('./routes/reportes'));
app.use('/api/config', require('./routes/config'));

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
app.use(errorHandler);

module.exports = app;
