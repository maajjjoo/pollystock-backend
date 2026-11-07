import { Request, Response } from 'express';
import { getInventoryAnalytics } from '../services/analyticsService';
import * as businessService from '../services/businessService';

/** El análisis siempre usa el negocio del usuario autenticado, nunca un id enviado por el cliente. */
async function getUserBusinessId(req: Request): Promise<string> {
  const business = await businessService.getBusiness(req.userId!);
  if (!business) throw new Error('NO_BUSINESS');
  return business.id;
}
import { generateInventoryInsights, generateChatResponse, AIError } from '../services/geminiService';

export const getInsights = async (req: Request, res: Response): Promise<void> => {
  try {
    const analytics = await getInventoryAnalytics(await getUserBusinessId(req));

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

    if (error?.message === 'NO_BUSINESS' || error?.message === 'NO_BUSINESS_FOUND') {
      res.status(404).json({
        success: false,
        code: 'NO_BUSINESS',
        message: 'Aún no has configurado tu negocio.',
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
    const { message } = req.body || {};
    console.log(`[AI Chat Request] user: "${req.userId}", message: "${message}"`);

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

    const analytics = await getInventoryAnalytics(await getUserBusinessId(req));
    const result = await generateChatResponse(message, analytics);
    console.log(`[AI Chat Response] reply length: ${result.reply?.length}, reply preview: "${result.reply?.slice(0, 60)}..."`);

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

    if (error?.message === 'NO_BUSINESS' || error?.message === 'NO_BUSINESS_FOUND') {
      res.status(404).json({
        success: false,
        code: 'NO_BUSINESS',
        message: 'Aún no has configurado tu negocio.',
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
