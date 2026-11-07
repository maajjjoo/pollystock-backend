import { Request, Response } from 'express';
import * as movementService from '../services/movementService';
import * as businessService from '../services/businessService';

export const getMovements = async (req: Request, res: Response): Promise<void> => {
  try {
    const business = await businessService.getBusiness(req.businessId!);
    if (!business) {
      res.status(404).json({ success: false, code: 'NO_BUSINESS', message: 'No business configured yet.' });
      return;
    }

    const productId = req.query.productId as string | undefined;
    const movements = await movementService.getMovements(business.id, productId);
    res.json({ success: true, data: movements });
  } catch (error) {
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Error retrieving movements' });
  }
};

export const getMovementById = async (req: Request, res: Response): Promise<void> => {
  try {
    const business = await businessService.getBusiness(req.businessId!);
    if (!business) {
      res.status(404).json({ success: false, code: 'NO_BUSINESS', message: 'No business configured yet.' });
      return;
    }

    const movement = await movementService.getMovementById(business.id, req.params.id as string);
    if (!movement) {
      res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Movement not found' });
      return;
    }

    res.json({ success: true, data: movement });
  } catch (error) {
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Error retrieving movement' });
  }
};

export const createMovement = async (req: Request, res: Response): Promise<void> => {
  try {
    const business = await businessService.getBusiness(req.businessId!);
    if (!business) {
      res.status(404).json({ success: false, code: 'NO_BUSINESS', message: 'No business configured yet.' });
      return;
    }

    const { productId, type, quantity, note } = req.body;

    if (!productId || typeof productId !== 'string' || productId.trim() === '') {
      res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'productId is required' });
      return;
    }

    if (type !== 'ENTRY' && type !== 'EXIT') {
      res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'type must be ENTRY or EXIT' });
      return;
    }

    if (quantity === undefined || quantity === null || isNaN(Number(quantity)) || Number(quantity) <= 0) {
      res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Valid positive numeric quantity is required' });
      return;
    }

    try {
      const movement = await movementService.createMovement(business.id, {
        productId,
        type,
        quantity: Number(quantity),
        note
      });
      res.status(201).json({ success: true, data: movement });
    } catch (err: any) {
      if (err.message === 'PRODUCT_NOT_FOUND') {
        res.status(404).json({ success: false, code: 'PRODUCT_NOT_FOUND', message: 'Product does not exist or does not belong to this business' });
      } else if (err.message === 'INSUFFICIENT_STOCK') {
        res.status(400).json({ success: false, code: 'INSUFFICIENT_STOCK', message: 'No hay suficiente stock para realizar esta salida.' });
      } else if (err.message === 'INVALID_MOVEMENT_TYPE') {
        res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid movement type' });
      } else {
        throw err;
      }
    }
  } catch (error) {
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Error creating movement' });
  }
};
