import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

import businessRoutes from './routes/businessRoutes';
import attributeRoutes from './routes/attributeRoutes';
import productRoutes from './routes/productRoutes';
import movementRoutes from './routes/movementRoutes';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/business', businessRoutes);
app.use('/api/attributes', attributeRoutes);
app.use('/api/products', productRoutes);
app.use('/api/movements', movementRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log('Server is running on port ' + PORT);
});
