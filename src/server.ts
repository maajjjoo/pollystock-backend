import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

import businessRoutes from './routes/businessRoutes';
import attributeRoutes from './routes/attributeRoutes';
import productRoutes from './routes/productRoutes';
import movementRoutes from './routes/movementRoutes';
import aiRoutes from './routes/aiRoutes';
import authRoutes from './routes/authRoutes';
import { requireAuth } from './middleware/requireAuth';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// Rutas públicas
app.use('/api/auth', authRoutes);

// Rutas protegidas: requieren "Authorization: Bearer <token>"
app.use('/api/business', requireAuth, businessRoutes);
app.use('/api/attributes', requireAuth, attributeRoutes);
app.use('/api/products', requireAuth, productRoutes);
app.use('/api/movements', requireAuth, movementRoutes);
app.use('/api/ai', requireAuth, aiRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const HOST = process.env.HOST || '0.0.0.0';

if (process.env.NODE_ENV !== 'test') {
  app.listen(Number(PORT), HOST, () => {
    console.log(`Server is running on http://${HOST}:${PORT}`);
  });
}

export default app;
