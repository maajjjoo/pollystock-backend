import { Request, Response } from 'express';
import { getInventoryAnalytics } from '../services/analyticsService';
import { generateInventoryInsights, generateChatResponse, AIError } from '../services/geminiService';
import { isGeminiConfigured } from '../config/aiConfig';

/**
 * El análisis siempre usa el negocio del usuario autenticado (req.businessId, puesto por
 * requireAuth desde la base de datos). Cualquier businessId enviado por el cliente se ignora.
 */
function getUserBusinessId(req: Request): string {
  if (!req.businessId) throw new Error('NO_BUSINESS');
  return req.businessId;
}

/** Falla rápido (503) si la IA no está configurada, antes de consultar la base de datos. */
function assertAIConfigured() {
  if (!isGeminiConfigured()) {
    throw new AIError(
      'El servicio de IA no está configurado. La variable de entorno GEMINI_API_KEY no ha sido configurada en el servidor.',
      503,
      'AI_NOT_CONFIGURED'
    );
  }
}

export const getInsights = async (req: Request, res: Response): Promise<void> => {
  try {
    assertAIConfigured();
    const analytics = await getInventoryAnalytics(getUserBusinessId(req));

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

    assertAIConfigured();
    const analytics = await getInventoryAnalytics(getUserBusinessId(req));
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
