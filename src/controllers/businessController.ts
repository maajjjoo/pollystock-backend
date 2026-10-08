import { Request, Response } from 'express';
import * as businessService from '../services/businessService';

export const getBusiness = async (req: Request, res: Response): Promise<void> => {
  try {
    const business = await businessService.getBusiness();
    if (!business) {
      res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'No business configured yet.' });
      return;
    }
    res.json({ success: true, data: business });
  } catch (error) {
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Error retrieving business' });
  }
};

export const upsertBusiness = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, businessType, productType, defaultUnit } = req.body;
    
    // Validation
    if (!name || typeof name !== 'string' || name.trim() === '') {
      res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Name is required' });
      return;
    }
    if (!businessType || typeof businessType !== 'string' || businessType.trim() === '') {
      res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Business type is required' });
      return;
    }
    if (!productType || typeof productType !== 'string' || productType.trim() === '') {
      res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Product type is required' });
      return;
    }
    if (!defaultUnit || typeof defaultUnit !== 'string' || defaultUnit.trim() === '') {
      res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Default unit is required' });
      return;
    }

    if (req.body.useMinStock && (req.body.minStock === undefined || req.body.minStock === null || isNaN(Number(req.body.minStock)))) {
      res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Valid minStock is required when useMinStock is true' });
      return;
    }

    const business = await businessService.upsertBusiness(req.body);
    res.json({ success: true, data: business });
  } catch (error) {
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Error saving business' });
  }
};

export const getAttributes = async (req: Request, res: Response): Promise<void> => {
  try {
    const business = await businessService.getBusiness();
    if (!business) {
      res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'No business configured yet.' });
      return;
    }
    const attributes = await businessService.getAttributes(business.id);
    res.json({ success: true, data: attributes });
  } catch (error) {
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Error retrieving attributes' });
  }
};

export const syncAttributes = async (req: Request, res: Response): Promise<void> => {
  try {
    const business = await businessService.getBusiness();
    if (!business) {
      res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'No business configured yet.' });
      return;
    }

    const attributesData = req.body.attributes;
    if (!Array.isArray(attributesData)) {
      res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Attributes must be an array' });
      return;
    }

    const validTypes = ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'OPTIONS'];

    for (const attr of attributesData) {
      if (!attr.name || typeof attr.name !== 'string' || attr.name.trim() === '') {
        res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Attribute name is required' });
        return;
      }
      if (!validTypes.includes(attr.dataType)) {
        res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid dataType: ' + attr.dataType });
        return;
      }
      if (attr.dataType === 'OPTIONS') {
        if (!attr.options || attr.options.trim() === '' || attr.options === '[]') {
          res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'OPTIONS type requires valid options array string' });
          return;
        }
      }
    }

    const result = await businessService.syncAttributes(business.id, attributesData);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Error syncing attributes' });
  }
};
