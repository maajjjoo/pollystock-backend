import { Router } from 'express';
import * as businessController from '../controllers/businessController';

const router = Router();

router.get('/', businessController.getAttributes);
router.post('/', businessController.syncAttributes);

export default router;
