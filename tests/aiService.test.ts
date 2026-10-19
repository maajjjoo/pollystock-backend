import process from 'node:process';
import prisma from '../src/config/db';
import {
  getGeminiApiKey,
  getGeminiModel,
  isGeminiConfigured,
  getMaskedApiKey,
} from '../src/config/aiConfig';
import {
  generateInventoryInsights,
  generateChatResponse,
  normalizeAIError,
  AIError,
  GeminiClientInterface,
} from '../src/services/geminiService';
import { buildInventoryContextSummary } from '../src/services/aiContextService';
import { InventoryAnalytics, computeInventoryMetrics } from '../src/services/analyticsService';
import * as aiController from '../src/controllers/aiController';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string) {
  const isMatch = JSON.stringify(actual) === JSON.stringify(expected);
  if (isMatch) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message} (Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)})`);
  }
}

function createMockClient(options: {
  textResponse?: string | null;
  throwError?: any;
  onCall?: (params: any) => void;
}): GeminiClientInterface {
  return {
    models: {
      generateContent: async (params: any) => {
        if (options.onCall) {
          options.onCall(params);
        }
        if (options.throwError) {
          throw options.throwError;
        }
        return {
          text: options.textResponse !== undefined ? options.textResponse : 'Mock AI analysis text',
        };
      },
    },
  };
}

function createMockReqRes(options: { query?: any; body?: any }) {
  const req: any = { query: options.query || {}, body: options.body || {} };
  let statusCode = 200;
  let jsonBody: any = null;

  const res: any = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: any) {
      jsonBody = data;
      return res;
    },
    getStatusCode: () => statusCode,
    getBody: () => jsonBody,
  };

  return { req, res };
}

const sampleAnalytics: InventoryAnalytics = computeInventoryMetrics(
  {
    id: 'biz-test',
    name: 'Polly Moda',
    businessType: 'Ropa y Accesorios',
    defaultUnit: 'prendas',
    useMinStock: true,
    minStock: 5,
  },
  [
    { id: 'p1', name: 'Camisa Lino', sku: 'CAM-01', category: 'Camisas', basePrice: 45000, stockQuantity: 0, createdAt: new Date() },
    { id: 'p2', name: 'Pantalón Chino', sku: 'PAN-02', category: 'Pantalones', basePrice: 85000, stockQuantity: 3, createdAt: new Date() },
    { id: 'p3', name: 'Chaqueta Denim', sku: 'CHQ-03', category: 'Chaquetas', basePrice: 120000, stockQuantity: 15, createdAt: new Date() },
  ],
  [
    { id: 'm1', productId: 'p2', type: 'EXIT', quantity: 2, note: 'Venta', date: new Date() },
    { id: 'm2', productId: 'p3', type: 'ENTRY', quantity: 10, note: 'Compra', date: new Date() },
  ]
);

async function runAITests() {
  console.log('====================================================');
  console.log('TEST SUITE: Gemini AI Integration (Stage 2)');
  console.log('====================================================\n');

  const originalEnvKey = process.env.GEMINI_API_KEY;
  const originalEnvModel = process.env.GEMINI_MODEL;

  try {
    // ----------------------------------------------------
    // TEST 1: Configuración sin clave de Gemini
    // ----------------------------------------------------
    console.log('Test 1: Configuración sin clave de Gemini');
    delete process.env.GEMINI_API_KEY;
    assertEquals(isGeminiConfigured(), false, 'isGeminiConfigured() es false cuando no hay clave');
    assertEquals(getGeminiApiKey(), undefined, 'getGeminiApiKey() retorna undefined');

    let threwExpectedError = false;
    try {
      await generateInventoryInsights(sampleAnalytics);
    } catch (e: any) {
      if (e instanceof AIError && e.code === 'AI_NOT_CONFIGURED' && e.statusCode === 503) {
        threwExpectedError = true;
      }
    }
    assert(threwExpectedError, 'generateInventoryInsights lanza 503 AI_NOT_CONFIGURED sin clave');

    // ----------------------------------------------------
    // TEST 2: Inicialización correcta del servicio y enmascaramiento
    // ----------------------------------------------------
    console.log('\nTest 2: Inicialización correcta del servicio y enmascaramiento de claves');
    process.env.GEMINI_API_KEY = 'AIzaSyFakeKeyForUnitTestsOnly987654321';
    assertEquals(isGeminiConfigured(), true, 'isGeminiConfigured() es true con clave configurada');
    assertEquals(getGeminiModel(), 'gemini-3.8-flash', 'Modelo por defecto es gemini-3.8-flash');

    process.env.GEMINI_MODEL = 'gemini-custom-pro';
    assertEquals(getGeminiModel(), 'gemini-custom-pro', 'Respeta modelo configurado en variable GEMINI_MODEL');
    delete process.env.GEMINI_MODEL;

    const masked = getMaskedApiKey();
    assert(masked.startsWith('AIza') && masked.endsWith('4321') && masked.includes('...'), 'Enmascara clave correctamente');
    assert(!masked.includes('FakeKeyForUnitTests'), 'No expone la clave secreta completa');

    // ----------------------------------------------------
    // TEST 3: Generación de análisis con métricas simuladas
    // ----------------------------------------------------
    console.log('\nTest 3: Generación de análisis con métricas simuladas');
    let capturedPrompt = '';
    const mockClientForInsights = createMockClient({
      textResponse: 'Diagnóstico: El inventario presenta 1 producto agotado (Camisa Lino) y 1 bajo stock mínimo (Pantalón Chino).',
      onCall: (p) => { capturedPrompt = p.contents; },
    });

    const insightsResult = await generateInventoryInsights(sampleAnalytics, { client: mockClientForInsights });
    assert(typeof insightsResult.text === 'string' && insightsResult.text.length > 0, 'Genera texto de análisis');
    assert(capturedPrompt.includes('Polly Moda'), 'El prompt incluye el nombre del negocio');
    assert(capturedPrompt.includes('Camisa Lino'), 'El prompt incluye el producto agotado');
    assert(capturedPrompt.includes('Pantalón Chino'), 'El prompt incluye producto con stock bajo');
    assert(capturedPrompt.includes('prendas'), 'El prompt incluye la unidad de medida');

    // ----------------------------------------------------
    // TEST 4: Respuesta del chat con contexto de inventario
    // ----------------------------------------------------
    console.log('\nTest 4: Respuesta del chat con contexto de inventario');
    let capturedChatPrompt = '';
    const mockClientForChat = createMockClient({
      textResponse: 'Te recomiendo reponer primero la Camisa Lino (agotada a 0) y luego el Pantalón Chino.',
      onCall: (p) => { capturedChatPrompt = p.contents; },
    });

    const chatResult = await generateChatResponse(
      '¿Qué productos debería reponer primero?',
      sampleAnalytics,
      { client: mockClientForChat }
    );
    assert(chatResult.reply.includes('Camisa Lino'), 'La respuesta responde con base en las existencias');
    assert(capturedChatPrompt.includes('¿Qué productos debería reponer primero?'), 'El prompt incluye la pregunta del usuario');
    assert(capturedChatPrompt.includes('--- DATOS DEL INVENTARIO ACTUAL ---'), 'El prompt incluye el bloque de inventario');

    // ----------------------------------------------------
    // TEST 5: Mensajes vacíos o demasiado largos
    // ----------------------------------------------------
    console.log('\nTest 5: Validación de mensajes vacíos o excesivamente largos');
    let threwEmpty = false;
    try {
      await generateChatResponse('', sampleAnalytics, { client: mockClientForChat });
    } catch (e: any) {
      if (e instanceof AIError && e.code === 'VALIDATION_ERROR' && e.statusCode === 400) {
        threwEmpty = true;
      }
    }
    assert(threwEmpty, 'Rechaza mensaje vacío con 400 VALIDATION_ERROR');

    let threwWhitespace = false;
    try {
      await generateChatResponse('    ', sampleAnalytics, { client: mockClientForChat });
    } catch (e: any) {
      if (e instanceof AIError && e.code === 'VALIDATION_ERROR' && e.statusCode === 400) {
        threwWhitespace = true;
      }
    }
    assert(threwWhitespace, 'Rechaza mensaje solo con espacios en blanco con 400 VALIDATION_ERROR');

    let threwLong = false;
    const veryLongMessage = 'a'.repeat(1001);
    try {
      await generateChatResponse(veryLongMessage, sampleAnalytics, { client: mockClientForChat });
    } catch (e: any) {
      if (e instanceof AIError && e.code === 'VALIDATION_ERROR' && e.statusCode === 400) {
        threwLong = true;
      }
    }
    assert(threwLong, 'Rechaza mensaje de más de 1000 caracteres con 400 VALIDATION_ERROR');

    // ----------------------------------------------------
    // TEST 6: Respuestas vacías del proveedor
    // ----------------------------------------------------
    console.log('\nTest 6: Manejo de respuestas vacías del proveedor');
    const mockEmptyClient = createMockClient({ textResponse: '' });
    let threwEmptyResponse = false;
    try {
      await generateInventoryInsights(sampleAnalytics, { client: mockEmptyClient });
    } catch (e: any) {
      if (e instanceof AIError && e.code === 'AI_EMPTY_RESPONSE' && e.statusCode === 502) {
        threwEmptyResponse = true;
      }
    }
    assert(threwEmptyResponse, 'Maneja respuesta vacía con 502 AI_EMPTY_RESPONSE');

    // ----------------------------------------------------
    // TEST 7: Errores de conexión y límites del proveedor
    // ----------------------------------------------------
    console.log('\nTest 7: Normalización de errores de conexión y límites de cuota');
    const quotaErr = normalizeAIError(new Error('RESOURCE_EXHAUSTED: quota exceeded'));
    assertEquals(quotaErr.statusCode, 429, 'Error de cuota mapeado a 429');
    assertEquals(quotaErr.code, 'AI_RATE_LIMIT', 'Código mapeado a AI_RATE_LIMIT');

    const authErr = normalizeAIError(new Error('API_KEY_INVALID: key expired'));
    assertEquals(authErr.statusCode, 401, 'Error de autenticación mapeado a 401');
    assertEquals(authErr.code, 'AI_AUTH_ERROR', 'Código mapeado a AI_AUTH_ERROR');

    const netErr = normalizeAIError(new Error('fetch failed: connect ECONNREFUSED'));
    assertEquals(netErr.statusCode, 503, 'Error de conexión mapeado a 503');
    assertEquals(netErr.code, 'AI_NETWORK_ERROR', 'Código mapeado a AI_NETWORK_ERROR');

    assert(!quotaErr.message.includes('key') && !authErr.message.includes('APIza'), 'No expone información interna');

    // ----------------------------------------------------
    // TEST 8: Datos históricos insuficientes
    // ----------------------------------------------------
    console.log('\nTest 8: Advertencia por datos históricos insuficientes');
    const analyticsMinimal = computeInventoryMetrics(
      { id: 'b1', name: 'Tienda Nueva', businessType: 'General', defaultUnit: 'u', useMinStock: false, minStock: null },
      [{ id: 'p1', name: 'Prod1', sku: null, category: null, basePrice: 10, stockQuantity: 20, createdAt: new Date() }],
      [{ id: 'm1', productId: 'p1', type: 'ENTRY', quantity: 20, note: null, date: new Date() }] // solo entrada
    );
    assertEquals(analyticsMinimal.historySufficiency.level, 'MINIMAL', 'Nivel de datos es MINIMAL (solo entradas)');
    assertEquals(analyticsMinimal.historySufficiency.canEstimateTrends, false, 'canEstimateTrends es false');

    const contextText = buildInventoryContextSummary(analyticsMinimal);
    assert(contextText.includes('MINIMAL'), 'El contexto explicita nivel MINIMAL');
    assert(contextText.includes('¿Permite proyectar tendencias con fiabilidad?: NO'), 'El contexto advierte que NO permite proyectar tendencias');

    // ----------------------------------------------------
    // TEST 9: Inmutabilidad de la base de datos (Operación estrictamente de solo lectura)
    // ----------------------------------------------------
    console.log('\nTest 9: Verificación de inmutabilidad en la base de datos');
    const productsCountBefore = await prisma.product.count();
    const movementsCountBefore = await prisma.movement.count();

    // Ejecutar generación de insights y chat
    await generateInventoryInsights(sampleAnalytics, { client: mockClientForInsights });
    await generateChatResponse('¿Cuánto stock queda?', sampleAnalytics, { client: mockClientForChat });

    const productsCountAfter = await prisma.product.count();
    const movementsCountAfter = await prisma.movement.count();

    assertEquals(productsCountAfter, productsCountBefore, 'Cantidad de productos no fue alterada');
    assertEquals(movementsCountAfter, movementsCountBefore, 'Cantidad de movimientos no fue alterada');

    // ----------------------------------------------------
    // TEST 10: Respuestas HTTP y estructura JSON de ambos endpoints
    // ----------------------------------------------------
    console.log('\nTest 10: Estructura JSON y respuestas HTTP de endpoints');

    // 10A: chat con validación fallida (mensaje vacío)
    const mockReqResChatBad = createMockReqRes({ body: { message: '' } });
    await aiController.chat(mockReqResChatBad.req, mockReqResChatBad.res);
    assertEquals(mockReqResChatBad.res.getStatusCode(), 400, 'Chat vacío devuelve HTTP 400');
    assertEquals(mockReqResChatBad.res.getBody().success, false, 'success es false');
    assertEquals(mockReqResChatBad.res.getBody().code, 'VALIDATION_ERROR', 'code es VALIDATION_ERROR');

    // 10B: chat cuando Gemini no está configurado
    delete process.env.GEMINI_API_KEY;
    const mockReqResChatUnconfigured = createMockReqRes({ body: { message: 'Hola' } });
    await aiController.chat(mockReqResChatUnconfigured.req, mockReqResChatUnconfigured.res);
    assertEquals(mockReqResChatUnconfigured.res.getStatusCode(), 503, 'Chat sin clave devuelve HTTP 503');
    assertEquals(mockReqResChatUnconfigured.res.getBody().success, false, 'success es false');
    assertEquals(mockReqResChatUnconfigured.res.getBody().code, 'AI_NOT_CONFIGURED', 'code es AI_NOT_CONFIGURED');

    // 10C: insights cuando Gemini no está configurado
    const mockReqResInsightsUnconfigured = createMockReqRes({});
    await aiController.getInsights(mockReqResInsightsUnconfigured.req, mockReqResInsightsUnconfigured.res);
    assertEquals(mockReqResInsightsUnconfigured.res.getStatusCode(), 503, 'Insights sin clave devuelve HTTP 503');
    assertEquals(mockReqResInsightsUnconfigured.res.getBody().success, false, 'success es false');
    assertEquals(mockReqResInsightsUnconfigured.res.getBody().code, 'AI_NOT_CONFIGURED', 'code es AI_NOT_CONFIGURED');

    console.log('\n====================================================');
    console.log(`RESULTADOS: ${passed} pruebas superadas, ${failed} fallos`);
    console.log('====================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    // Restaurar entorno
    if (originalEnvKey) {
      process.env.GEMINI_API_KEY = originalEnvKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
    if (originalEnvModel) {
      process.env.GEMINI_MODEL = originalEnvModel;
    } else {
      delete process.env.GEMINI_MODEL;
    }
  }
}

runAITests().catch((err) => {
  console.error('Error fatal ejecutando suite de pruebas de IA:', err);
  process.exit(1);
});
