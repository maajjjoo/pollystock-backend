import { Request, Response } from 'express';
import { getInventoryAnalytics } from '../services/analyticsService';
import { generateInventoryInsights, generateChatResponse, AIError } from '../services/geminiService';

export const getInsights = async (req: Request, res: Response): Promise<void> => {
  try {
    const businessId = (req.query.businessId as string) || undefined;
    const analytics = await getInventoryAnalytics(businessId);

    const result = await generateInventoryInsights(analytics);

    res.json({
      success: true,
      data: {
        summary: result.text,
        metrics: analytics,
        historySufficiency: analytics.historySufficiency,
        model: result.model,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    if (error instanceof AIError) {
      res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
      return;
    }

    if (error?.message === 'NO_BUSINESS_FOUND') {
      res.status(404).json({
        success: false,
        code: 'NO_BUSINESS',
        message: 'No hay un negocio configurado en el sistema todavía.',
      });
      return;
    }

    console.error('Error in getInsights:', error?.message || error);
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Error al generar análisis de inventario con IA.',
    });
  }
};

export const chat = async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, businessId } = req.body || {};

    if (!message || typeof message !== 'string' || message.trim() === '') {
      res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'El mensaje es obligatorio y debe ser una cadena de texto no vacía.',
      });
      return;
    }

    if (message.trim().length > 1000) {
      res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: `El mensaje excede la longitud máxima permitida de 1000 caracteres (recibidos: ${message.trim().length}).`,
      });
      return;
    }

    const analytics = await getInventoryAnalytics(businessId);
    const result = await generateChatResponse(message, analytics);

    res.json({
      success: true,
      data: {
        reply: result.reply,
        historySufficiency: analytics.historySufficiency,
        model: result.model,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    if (error instanceof AIError) {
      res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
      return;
    }

    if (error?.message === 'NO_BUSINESS_FOUND') {
      res.status(404).json({
        success: false,
        code: 'NO_BUSINESS',
        message: 'No hay un negocio configurado en el sistema todavía.',
      });
      return;
    }

    console.error('Error in chat:', error?.message || error);
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Error al procesar la consulta con el asistente de IA.',
    });
  }
};
