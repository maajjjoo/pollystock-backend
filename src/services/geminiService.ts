import { GoogleGenAI } from '@google/genai';
import { getGeminiApiKey, getGeminiModel, isGeminiConfigured } from '../config/aiConfig';
import { InventoryAnalytics } from './analyticsService';
import { SYSTEM_INSTRUCTION, buildInventoryContextSummary } from './aiContextService';

export class AIError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode: number = 500, code: string = 'AI_SERVICE_ERROR') {
    super(message);
    this.name = 'AIError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface GeminiClientInterface {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config?: {
        systemInstruction?: string;
        temperature?: number;
        maxOutputTokens?: number;
      };
    }): Promise<{ text?: string | null; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }>;
  };
}

let defaultGenAIClient: GoogleGenAI | null = null;

export const getGoogleGenAIClient = (): GeminiClientInterface => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new AIError(
      'El servicio de IA no está configurado. La variable de entorno GEMINI_API_KEY no ha sido configurada en el servidor.',
      503,
      'AI_NOT_CONFIGURED'
    );
  }

  if (!defaultGenAIClient) {
    defaultGenAIClient = new GoogleGenAI({ apiKey });
  }

  return defaultGenAIClient as unknown as GeminiClientInterface;
};

/**
 * Resets the cached Gemini client instance (useful for testing).
 */
export const resetGeminiClient = (): void => {
  defaultGenAIClient = null;
};

/**
 * Maps external SDK or network errors into clean, safe AIError instances
 * without leaking API keys, credentials or internal stack traces.
 */
export const normalizeAIError = (error: any): AIError => {
  if (error instanceof AIError) {
    return error;
  }

  const rawMessage = error?.message || String(error || '');
  const status = error?.status || error?.statusCode;

  // 1. Quota / Rate limit (429)
  if (
    status === 429 ||
    rawMessage.includes('429') ||
    rawMessage.includes('RESOURCE_EXHAUSTED') ||
    rawMessage.toLowerCase().includes('quota') ||
    rawMessage.toLowerCase().includes('rate limit')
  ) {
    return new AIError(
      'Límite de solicitudes o cuota excedida en el proveedor de IA. Por favor, intenta de nuevo más tarde.',
      429,
      'AI_RATE_LIMIT'
    );
  }

  // 2. Auth / Invalid API Key (401 / 403)
  if (
    status === 401 ||
    status === 403 ||
    rawMessage.includes('API_KEY_INVALID') ||
    rawMessage.includes('PERMISSION_DENIED') ||
    rawMessage.toLowerCase().includes('api key not valid')
  ) {
    return new AIError(
      'La clave de API de Gemini no es válida o no tiene permisos suficientes.',
      401,
      'AI_AUTH_ERROR'
    );
  }

  // 3. Network / Connection errors (503, 504, ECONNREFUSED, ENOTFOUND, timeout)
  if (
    status === 503 ||
    status === 504 ||
    rawMessage.includes('UNAVAILABLE') ||
    rawMessage.includes('DEADLINE_EXCEEDED') ||
    rawMessage.includes('fetch failed') ||
    rawMessage.includes('ECONNREFUSED') ||
    rawMessage.includes('ENOTFOUND') ||
    rawMessage.includes('ETIMEDOUT')
  ) {
    return new AIError(
      'No fue posible establecer conexión con los servidores de Google Gemini. Verifica la conexión de red.',
      503,
      'AI_NETWORK_ERROR'
    );
  }

  // 4. Default / unexpected internal error
  return new AIError(
    'Ocurrió un error inesperado al procesar la consulta con el asistente de IA.',
    500,
    'AI_SERVICE_ERROR'
  );
};

export interface AIOptions {
  client?: GeminiClientInterface;
  model?: string;
  temperature?: number;
}

/**
 * Generates structured inventory insights and recommendations.
 */
export async function generateInventoryInsights(
  analytics: InventoryAnalytics,
  options?: AIOptions
): Promise<{ text: string; model: string }> {
  if (!isGeminiConfigured() && !options?.client) {
    throw new AIError(
      'El servicio de IA no está configurado. La variable de entorno GEMINI_API_KEY no ha sido configurada en el servidor.',
      503,
      'AI_NOT_CONFIGURED'
    );
  }

  const client = options?.client || getGoogleGenAIClient();
  const model = options?.model || getGeminiModel();
  const context = buildInventoryContextSummary(analytics);

  const prompt = `A continuación se presentan los datos factuales y métricas deterministas del inventario actual de PollyStock:

--- CONTEXTO DEL INVENTARIO ---
${context}
--- FIN DEL CONTEXTO ---

TAREA DE ANÁLISIS:
Genera un informe analítico estructurado en español para el comerciante. Tu análisis debe incluir:
1. **Diagnóstico general**: Estado actual de existencias y valoración monetaria.
2. **Alertas operativas prioritarias**: Detalla productos agotados y con stock bajo (mencionando su stock y déficit).
3. **Comportamiento de salidas**: Resalta los productos con mayor cantidad de unidades egresadas en 7 y 30 días.
4. **Productos sin actividad reciente**: Identifica los productos sin salidas en los últimos 30 días, aclarando si tuvieron movimientos previos.
5. **Recomendaciones de reposición**: Sugiere acciones de abastecimiento concretas, enfatizando que son recomendaciones a validar por el usuario.
6. **Tendencias y proyecciones**: Si el nivel de suficiencia histórica es insuficiente (NONE o MINIMAL), advierte que faltan datos antes de proyectar. Si es adecuado, formula estimaciones de cobertura de stock prudenciales.
7. **Limitaciones de los datos**: Explica qué información adicional enriquecería las proyecciones.`;

  try {
    const response = await client.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: options?.temperature ?? 0.2,
      },
    });

    const responseText = response.text || response?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText || responseText.trim() === '') {
      throw new AIError(
        'El proveedor de IA devolvió una respuesta vacía o incompleta.',
        502,
        'AI_EMPTY_RESPONSE'
      );
    }

    return {
      text: responseText.trim(),
      model,
    };
  } catch (error: any) {
    throw normalizeAIError(error);
  }
}

/**
 * Generates an answer to a user question grounded in the real inventory analytics.
 */
export async function generateChatResponse(
  userMessage: string,
  analytics: InventoryAnalytics,
  options?: AIOptions
): Promise<{ reply: string; model: string }> {
  // 1. Validation of message
  if (!userMessage || typeof userMessage !== 'string' || userMessage.trim() === '') {
    throw new AIError('El mensaje no puede estar vacío.', 400, 'VALIDATION_ERROR');
  }

  const trimmedMessage = userMessage.trim();
  if (trimmedMessage.length > 1000) {
    throw new AIError(
      `El mensaje excede la longitud máxima permitida (1000 caracteres). Caracteres recibidos: ${trimmedMessage.length}.`,
      400,
      'VALIDATION_ERROR'
    );
  }

  // 2. Configuration check
  if (!isGeminiConfigured() && !options?.client) {
    throw new AIError(
      'El servicio de IA no está configurado. La variable de entorno GEMINI_API_KEY no ha sido configurada en el servidor.',
      503,
      'AI_NOT_CONFIGURED'
    );
  }

  const client = options?.client || getGoogleGenAIClient();
  const model = options?.model || getGeminiModel();
  const context = buildInventoryContextSummary(analytics);

  const prompt = `--- DATOS DEL INVENTARIO ACTUAL ---
${context}
--- FIN DE LOS DATOS ---

PREGUNTA DEL USUARIO:
"${trimmedMessage}"

INSTRUCCIONES PARA LA RESPUESTA:
- Responde a la pregunta del usuario utilizando de forma estricta los datos factuales del inventario suministrados arriba.
- Si la pregunta indaga sobre un producto inexistente en la lista o solicita proyecciones sin datos históricos suficientes, explica con claridad la limitación.
- Proporciona una respuesta clara, concisa, profesional y en español natural.`;

  try {
    const response = await client.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: options?.temperature ?? 0.3,
      },
    });

    const replyText = response.text || response?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!replyText || replyText.trim() === '') {
      throw new AIError(
        'El proveedor de IA devolvió una respuesta vacía o incompleta.',
        502,
        'AI_EMPTY_RESPONSE'
      );
    }

    return {
      reply: replyText.trim(),
      model,
    };
  } catch (error: any) {
    throw normalizeAIError(error);
  }
}
