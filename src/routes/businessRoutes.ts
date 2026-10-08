import { Router } from 'express';
import * as businessController from '../controllers/businessController';

const router = Router();

router.get('/', businessController.getBusiness);
router.put('/', businessController.upsertBusiness);

export default router;
