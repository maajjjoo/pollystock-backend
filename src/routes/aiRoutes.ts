import { Router } from 'express';
import * as aiController from '../controllers/aiController';

const router = Router();

router.get('/insights', aiController.getInsights);
router.post('/chat', aiController.chat);

export default router;
