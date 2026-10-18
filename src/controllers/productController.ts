import { Request, Response } from 'express';
import * as productService from '../services/productService';
import * as businessService from '../services/businessService';

export const getProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const business = await businessService.getBusiness();
    if (!business) {
      res.status(404).json({ success: false, code: 'NO_BUSINESS', message: 'No business configured yet.' });
      return;
    }

    const search = req.query.search as string | undefined;
    const products = await productService.getProducts(business.id, search);
    
    // Parse dynamicAttributes from string back to object
    const parsedProducts = products.map(p => ({
      ...p,
      dynamicAttributes: p.dynamicAttributes ? JSON.parse(p.dynamicAttributes) : {}
    }));

    res.json({ success: true, data: parsedProducts });
  } catch (error: any) {
    console.error('Error retrieving products:', error);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: error?.message || 'Error retrieving products' });
  }
};

export const getProductById = async (req: Request, res: Response): Promise<void> => {
  try {
    const business = await businessService.getBusiness();
    if (!business) {
      res.status(404).json({ success: false, code: 'NO_BUSINESS', message: 'No business configured yet.' });
      return;
    }

    const product = await productService.getProductById(business.id, req.params.id as string);
    if (!product) {
      res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Product not found' });
      return;
    }

    const parsedProduct = {
      ...product,
      dynamicAttributes: product.dynamicAttributes ? JSON.parse(product.dynamicAttributes) : {}
    };

    res.json({ success: true, data: parsedProduct });
  } catch (error: any) {
    console.error('Error retrieving product:', error);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: error?.message || 'Error retrieving product' });
  }
};

export const createProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const business = await businessService.getBusiness();
    if (!business) {
      res.status(404).json({ success: false, code: 'NO_BUSINESS', message: 'No business configured yet.' });
      return;
    }

    const { name, basePrice, stockQuantity, sku, category, imageUrl, dynamicAttributes } = req.body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Product name is required' });
      return;
    }

    if (basePrice === undefined || basePrice === null || isNaN(Number(basePrice)) || Number(basePrice) < 0) {
      res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Valid non-negative basePrice is required' });
      return;
    }

    if (stockQuantity === undefined || stockQuantity === null || isNaN(Number(stockQuantity)) || Number(stockQuantity) < 0) {
      res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Valid non-negative stockQuantity is required' });
      return;
    }

    let sanitizedDynamicAttributes: Record<string, any> = {};
    if (dynamicAttributes !== undefined) {
      const definitions = await businessService.getAttributes(business.id);
      sanitizedDynamicAttributes = productService.sanitizeDynamicAttributes(dynamicAttributes, definitions);
      try {
        productService.validateDynamicAttributes(sanitizedDynamicAttributes, definitions);
      } catch (err: any) {
        res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: err.message });
        return;
      }
    }

    const productData = {
      name: name.trim(),
      basePrice: Number(basePrice),
      stockQuantity: Number(stockQuantity),
      sku: sku || null,
      category: category || null,
      imageUrl: imageUrl || null,
      dynamicAttributes: JSON.stringify(sanitizedDynamicAttributes),
    };

    const newProduct = await productService.createProduct(business.id, productData);
    
    res.status(201).json({ success: true, data: { ...newProduct, dynamicAttributes: JSON.parse(newProduct.dynamicAttributes) } });
  } catch (error: any) {
    console.error('Error creating product:', error);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: error?.message || 'Error creating product' });
  }
};

export const updateProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const business = await businessService.getBusiness();
    if (!business) {
      res.status(404).json({ success: false, code: 'NO_BUSINESS', message: 'No business configured yet.' });
      return;
    }

    const existingProduct = await productService.getProductById(business.id, req.params.id as string);
    if (!existingProduct) {
      res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Product not found' });
      return;
    }

    const { name, basePrice, stockQuantity, sku, category, imageUrl, dynamicAttributes } = req.body;

    if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
      res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Product name cannot be empty' });
      return;
    }

    if (basePrice !== undefined && (isNaN(Number(basePrice)) || Number(basePrice) < 0)) {
      res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Valid non-negative basePrice is required' });
      return;
    }

    if (stockQuantity !== undefined && (isNaN(Number(stockQuantity)) || Number(stockQuantity) < 0)) {
      res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Valid non-negative stockQuantity is required' });
      return;
    }

    let sanitizedDynamicAttributes: Record<string, any> | undefined = undefined;
    if (dynamicAttributes !== undefined) {
      const definitions = await businessService.getAttributes(business.id);
      sanitizedDynamicAttributes = productService.sanitizeDynamicAttributes(dynamicAttributes, definitions);
      try {
        productService.validateDynamicAttributes(sanitizedDynamicAttributes, definitions);
      } catch (err: any) {
        res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: err.message });
        return;
      }
    }

    const productData: any = {};
    if (name !== undefined) productData.name = name.trim();
    if (basePrice !== undefined) productData.basePrice = Number(basePrice);
    if (stockQuantity !== undefined) productData.stockQuantity = Number(stockQuantity);
    if (sku !== undefined) productData.sku = sku || null;
    if (category !== undefined) productData.category = category || null;
    if (imageUrl !== undefined) productData.imageUrl = imageUrl || null;
    if (sanitizedDynamicAttributes !== undefined) productData.dynamicAttributes = JSON.stringify(sanitizedDynamicAttributes);

    const updatedProduct = await productService.updateProduct(business.id, req.params.id as string, productData);
    
    res.json({ success: true, data: { ...updatedProduct, dynamicAttributes: JSON.parse(updatedProduct.dynamicAttributes) } });
  } catch (error: any) {
    console.error('Error updating product:', error);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: error?.message || 'Error updating product' });
  }
};

export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const business = await businessService.getBusiness();
    if (!business) {
      res.status(404).json({ success: false, code: 'NO_BUSINESS', message: 'No business configured yet.' });
      return;
    }

    const existingProduct = await productService.getProductById(business.id, req.params.id as string);
    if (!existingProduct) {
      res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Product not found' });
      return;
    }

    try {
      await productService.deleteProduct(business.id, req.params.id as string);
      res.json({ success: true, message: 'Product deleted successfully' });
    } catch (err: any) {
      if (err.message === 'PRODUCT_HAS_MOVEMENTS') {
        res.status(400).json({ 
          success: false, 
          code: 'PRODUCT_HAS_MOVEMENTS', 
          message: 'Product cannot be deleted because it has movement records.' 
        });
        return;
      }
      throw err;
    }
  } catch (error: any) {
    console.error('Error deleting product:', error);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: error?.message || 'Error deleting product' });
  }
};
