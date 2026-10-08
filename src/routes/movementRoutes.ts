import { Router } from 'express';
import * as movementController from '../controllers/movementController';

const router = Router();

router.get('/', movementController.getMovements);
router.get('/:id', movementController.getMovementById);
router.post('/', movementController.createMovement);

export default router;
