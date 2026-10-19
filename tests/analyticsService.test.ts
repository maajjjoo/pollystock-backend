import process from 'node:process';
import {
  computeInventoryMetrics,
  getInventoryAnalytics,
  BusinessConfigInput,
  ProductInput,
  MovementInput,
} from '../src/services/analyticsService';
import prisma from '../src/config/db';

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

async function runTests() {
  console.log('====================================================');
  console.log('TEST SUITE: Analytics Engine (analyticsService)');
  console.log('====================================================\n');

  const baseBusiness: BusinessConfigInput = {
    id: 'biz-1',
    name: 'Tienda Test',
    businessType: 'General',
    defaultUnit: 'unidades',
    useMinStock: false,
    minStock: null,
  };

  const refDate = new Date('2026-10-18T12:00:00.000Z');

  // ----------------------------------------------------
  // TEST 1: Inventario sin productos ni movimientos
  // ----------------------------------------------------
  console.log('Test 1: Inventario sin productos ni movimientos');
  const resEmpty = computeInventoryMetrics(baseBusiness, [], [], { referenceDate: refDate });
  assertEquals(resEmpty.stockSummary.totalProducts, 0, 'Total de productos es 0');
  assertEquals(resEmpty.stockSummary.totalUnitsInStock, 0, 'Total de unidades es 0');
  assertEquals(resEmpty.stockSummary.totalInventoryValue, 0, 'Valor de inventario es 0');
  assertEquals(resEmpty.stockoutMetrics.outOfStockCount, 0, 'Agotados es 0');
  assertEquals(resEmpty.minStockMetrics.lowStockCount, 0, 'Stock bajo es 0');
  assertEquals(resEmpty.historySufficiency.level, 'NONE', 'Nivel de suficiencia es NONE');
  assert(resEmpty.historySufficiency.reason.includes('No hay productos'), 'Indica razón de productos vacíos');

  // ----------------------------------------------------
  // TEST 2: Productos agotados vs stock disponible
  // ----------------------------------------------------
  console.log('\nTest 2: Productos agotados y con stock disponible');
  const productsT2: ProductInput[] = [
    { id: 'p1', name: 'Agotado Exacto', sku: 'A1', category: 'Cat1', basePrice: 10, stockQuantity: 0, createdAt: refDate },
    { id: 'p2', name: 'Agotado Negativo', sku: 'A2', category: 'Cat1', basePrice: 20, stockQuantity: -3, createdAt: refDate },
    { id: 'p3', name: 'Disponible Normal', sku: 'A3', category: 'Cat2', basePrice: 15, stockQuantity: 25, createdAt: refDate },
  ];
  const resT2 = computeInventoryMetrics(baseBusiness, productsT2, [], { referenceDate: refDate });
  assertEquals(resT2.stockSummary.totalProducts, 3, 'Total de productos es 3');
  assertEquals(resT2.stockSummary.inStockProductsCount, 1, 'Productos disponibles es 1');
  assertEquals(resT2.stockoutMetrics.outOfStockCount, 2, 'Productos agotados son 2');
  assert(resT2.stockoutMetrics.outOfStockProducts.some(p => p.id === 'p1'), 'Incluye producto p1 con stock 0');
  assert(resT2.stockoutMetrics.outOfStockProducts.some(p => p.id === 'p2'), 'Incluye producto p2 con stock negativo');
  assertEquals(resT2.stockSummary.totalInventoryValue, 375, 'Valor de inventario contempla solo disponibles (25 * 15)');

  // ----------------------------------------------------
  // TEST 3: Stock mínimo habilitado vs deshabilitado
  // ----------------------------------------------------
  console.log('\nTest 3: Stock mínimo habilitado vs deshabilitado');
  const productsT3: ProductInput[] = [
    { id: 'p1', name: 'Stock Bajo', sku: 'B1', category: null, basePrice: 10, stockQuantity: 3, createdAt: refDate },
    { id: 'p2', name: 'Stock Justo en Umbral', sku: 'B2', category: null, basePrice: 10, stockQuantity: 5, createdAt: refDate },
    { id: 'p3', name: 'Stock Holgado', sku: 'B3', category: null, basePrice: 10, stockQuantity: 12, createdAt: refDate },
    { id: 'p4', name: 'Stock Cero', sku: 'B4', category: null, basePrice: 10, stockQuantity: 0, createdAt: refDate },
  ];

  // Caso 3A: Deshabilitado
  const resT3Disabled = computeInventoryMetrics(
    { ...baseBusiness, useMinStock: false, minStock: 5 },
    productsT3,
    [],
    { referenceDate: refDate }
  );
  assertEquals(resT3Disabled.minStockMetrics.isMinStockEnabled, false, 'isMinStockEnabled es false cuando useMinStock=false');
  assertEquals(resT3Disabled.minStockMetrics.lowStockCount, 0, 'lowStockCount es 0 cuando está deshabilitado');

  // Caso 3B: Habilitado con umbral 5
  const resT3Enabled = computeInventoryMetrics(
    { ...baseBusiness, useMinStock: true, minStock: 5 },
    productsT3,
    [],
    { referenceDate: refDate }
  );
  assertEquals(resT3Enabled.minStockMetrics.isMinStockEnabled, true, 'isMinStockEnabled es true');
  assertEquals(resT3Enabled.minStockMetrics.minStockThreshold, 5, 'Umbral es 5');
  assertEquals(resT3Enabled.minStockMetrics.lowStockCount, 2, 'lowStockCount es 2 (p1 con 3 y p2 con 5)');
  assert(resT3Enabled.minStockMetrics.lowStockProducts.some(p => p.id === 'p1' && p.deficit === 2), 'p1 tiene deficit de 2 unidades');
  assert(!resT3Enabled.minStockMetrics.lowStockProducts.some(p => p.id === 'p4'), 'p4 con stock 0 no se duplica en lowStock (pertenece a agotados)');

  // ----------------------------------------------------
  // TEST 4: Entradas y salidas en los límites de períodos (7d y 30d)
  // ----------------------------------------------------
  console.log('\nTest 4: Límites temporales de períodos (7 y 30 días)');
  const msInDay = 24 * 60 * 60 * 1000;
  const movementsT4: MovementInput[] = [
    // Hace 2 días: Dentro de 7d y 30d
    { id: 'm1', productId: 'p1', type: 'ENTRY', quantity: 20, note: null, date: new Date(refDate.getTime() - 2 * msInDay) },
    // Hace 6 días: Dentro de 7d y 30d
    { id: 'm2', productId: 'p1', type: 'EXIT', quantity: 5, note: null, date: new Date(refDate.getTime() - 6 * msInDay) },
    // Hace 10 días: Fuera de 7d, pero Dentro de 30d
    { id: 'm3', productId: 'p1', type: 'EXIT', quantity: 8, note: null, date: new Date(refDate.getTime() - 10 * msInDay) },
    // Hace 29 días: Dentro de 30d
    { id: 'm4', productId: 'p1', type: 'ENTRY', quantity: 15, note: null, date: new Date(refDate.getTime() - 29 * msInDay) },
    // Hace 31 días: Fuera de 30d
    { id: 'm5', productId: 'p1', type: 'EXIT', quantity: 50, note: 'Muy antiguo', date: new Date(refDate.getTime() - 31 * msInDay) },
    // En el futuro (inválido / posterior a fecha de referencia): Fuera
    { id: 'm6', productId: 'p1', type: 'EXIT', quantity: 100, note: 'Futuro', date: new Date(refDate.getTime() + 1 * msInDay) },
  ];

  const resT4 = computeInventoryMetrics(baseBusiness, productsT3, movementsT4, { referenceDate: refDate });
  // Período 7 días: debe incluir m1 (ENTRY 20) y m2 (EXIT 5)
  assertEquals(resT4.periods.last7Days.entryMovementsCount, 1, '7d: 1 movimiento de entrada');
  assertEquals(resT4.periods.last7Days.entryUnitsTotal, 20, '7d: 20 unidades de entrada');
  assertEquals(resT4.periods.last7Days.exitMovementsCount, 1, '7d: 1 movimiento de salida');
  assertEquals(resT4.periods.last7Days.exitUnitsTotal, 5, '7d: 5 unidades de salida');
  assertEquals(resT4.periods.last7Days.netUnitsBalance, 15, '7d: balance neto +15');

  // Período 30 días: m1 (ENTRY 20), m2 (EXIT 5), m3 (EXIT 8), m4 (ENTRY 15) -> 2 entradas (35 u), 2 salidas (13 u)
  assertEquals(resT4.periods.last30Days.entryMovementsCount, 2, '30d: 2 movimientos de entrada');
  assertEquals(resT4.periods.last30Days.entryUnitsTotal, 35, '30d: 35 unidades de entrada');
  assertEquals(resT4.periods.last30Days.exitMovementsCount, 2, '30d: 2 movimientos de salida');
  assertEquals(resT4.periods.last30Days.exitUnitsTotal, 13, '30d: 13 unidades de salida');
  assertEquals(resT4.periods.last30Days.netUnitsBalance, 22, '30d: balance neto +22');

  // ----------------------------------------------------
  // TEST 5: Movimientos vs Unidades (Pocos movs/muchas u vs Muchos movs/pocas u)
  // ----------------------------------------------------
  console.log('\nTest 5: Distinción entre cantidad de movimientos vs volumen de unidades');
  const productsT5: ProductInput[] = [
    { id: 'p_heavy', name: 'Producto Mayorista', sku: 'H1', category: 'Mayoreo', basePrice: 100, stockQuantity: 50, createdAt: refDate },
    { id: 'p_frequent', name: 'Producto Menudeo', sku: 'F1', category: 'Menudeo', basePrice: 5, stockQuantity: 100, createdAt: refDate },
  ];

  const movementsT5: MovementInput[] = [
    // p_heavy: 1 solo movimiento de 80 unidades
    { id: 'mh1', productId: 'p_heavy', type: 'EXIT', quantity: 80, note: null, date: new Date(refDate.getTime() - 2 * msInDay) },
    // p_frequent: 4 movimientos de 5 unidades cada uno (total 20 unidades)
    { id: 'mf1', productId: 'p_frequent', type: 'EXIT', quantity: 5, note: null, date: new Date(refDate.getTime() - 1 * msInDay) },
    { id: 'mf2', productId: 'p_frequent', type: 'EXIT', quantity: 5, note: null, date: new Date(refDate.getTime() - 2 * msInDay) },
    { id: 'mf3', productId: 'p_frequent', type: 'EXIT', quantity: 5, note: null, date: new Date(refDate.getTime() - 3 * msInDay) },
    { id: 'mf4', productId: 'p_frequent', type: 'EXIT', quantity: 5, note: null, date: new Date(refDate.getTime() - 4 * msInDay) },
  ];

  const resT5 = computeInventoryMetrics(baseBusiness, productsT5, movementsT5, { referenceDate: refDate });
  const top30 = resT5.topExitedProducts.last30Days;
  assertEquals(top30.length, 2, 'Top 30d contiene los 2 productos con salidas');
  assertEquals(top30[0].productId, 'p_heavy', 'Top #1 por unidades de salida es p_heavy');
  assertEquals(top30[0].exitUnits, 80, 'p_heavy tiene 80 unidades de salida');
  assertEquals(top30[0].exitMovementsCount, 1, 'p_heavy tiene 1 solo movimiento');
  assertEquals(top30[1].productId, 'p_frequent', 'Top #2 por unidades es p_frequent');
  assertEquals(top30[1].exitUnits, 20, 'p_frequent tiene 20 unidades de salida');
  assertEquals(top30[1].exitMovementsCount, 4, 'p_frequent tiene 4 movimientos');

  // ----------------------------------------------------
  // TEST 6: Productos sin salidas en los últimos 30 días
  // ----------------------------------------------------
  console.log('\nTest 6: Productos sin salidas registradas en 30 días');
  const productsT6: ProductInput[] = [
    { id: 'p_active', name: 'Activo', sku: null, category: null, basePrice: 10, stockQuantity: 20, createdAt: refDate },
    { id: 'p_stagnant_old', name: 'Estancado Con Salida Antigua', sku: null, category: null, basePrice: 10, stockQuantity: 15, createdAt: refDate },
    { id: 'p_never_exited', name: 'Nuevo Sin Salidas Nunca', sku: null, category: null, basePrice: 10, stockQuantity: 50, createdAt: refDate },
  ];

  const movementsT6: MovementInput[] = [
    // Salida reciente para p_active
    { id: 'm1', productId: 'p_active', type: 'EXIT', quantity: 5, note: null, date: new Date(refDate.getTime() - 3 * msInDay) },
    // Salida antigua (> 30d) para p_stagnant_old
    { id: 'm2', productId: 'p_stagnant_old', type: 'EXIT', quantity: 2, note: null, date: new Date(refDate.getTime() - 45 * msInDay) },
    // Entrada para p_never_exited
    { id: 'm3', productId: 'p_never_exited', type: 'ENTRY', quantity: 50, note: null, date: new Date(refDate.getTime() - 5 * msInDay) },
  ];

  const resT6 = computeInventoryMetrics(baseBusiness, productsT6, movementsT6, { referenceDate: refDate });
  const noExitList = resT6.productsWithoutExitLast30Days.products;
  assertEquals(resT6.productsWithoutExitLast30Days.count, 2, '2 productos sin salidas en los últimos 30 días');
  const oldItem = noExitList.find(p => p.productId === 'p_stagnant_old');
  assert(oldItem !== undefined && oldItem.hasEverExited === true, 'p_stagnant_old indica hasEverExited=true');
  assert(oldItem !== undefined && oldItem.lastExitDate !== null, 'p_stagnant_old registra fecha de última salida histórica');
  const neverItem = noExitList.find(p => p.productId === 'p_never_exited');
  assert(neverItem !== undefined && neverItem.hasEverExited === false, 'p_never_exited indica hasEverExited=false');
  assertEquals(neverItem?.lastExitDate, null, 'p_never_exited tiene lastExitDate=null');

  // ----------------------------------------------------
  // TEST 7: Velocidad diaria y estimación de días de stock
  // ----------------------------------------------------
  console.log('\nTest 7: Velocidad media diaria y estimación de días de stock');
  const productsT7: ProductInput[] = [
    { id: 'p_steady', name: 'Rotación Estable', sku: null, category: null, basePrice: 10, stockQuantity: 60, createdAt: refDate },
  ];
  // 30 unidades de salida distribuidas en varios días durante 10 días
  const movementsT7: MovementInput[] = [
    { id: 'ms1', productId: 'p_steady', type: 'EXIT', quantity: 15, note: null, date: new Date(refDate.getTime() - 10 * msInDay) },
    { id: 'ms2', productId: 'p_steady', type: 'EXIT', quantity: 15, note: null, date: new Date(refDate.getTime() - 2 * msInDay) },
  ];

  const resT7 = computeInventoryMetrics(baseBusiness, productsT7, movementsT7, { referenceDate: refDate });
  const steadyMetric = resT7.productMetrics[0];
  assertEquals(steadyMetric.exitUnits30d, 30, 'Salidas totales en 30d es 30 u');
  assertEquals(steadyMetric.averageDailyExitRate30d, 1.0, 'Velocidad diaria promedio es 1.0 u/día (30 u / 30 días)');
  assertEquals(steadyMetric.estimatedDaysOfStockRemaining, 60.0, 'Días estimados de stock es 60.0 días (60 stock / 1.0 u/día)');
  assertEquals(steadyMetric.hasSufficientDataForEstimate, true, 'hasSufficientDataForEstimate es true');

  // Caso: Producto con stock 0 y velocidad > 0
  const productsT7B: ProductInput[] = [
    { id: 'p_empty', name: 'Agotado con Salidas', sku: null, category: null, basePrice: 10, stockQuantity: 0, createdAt: refDate },
  ];
  const resT7B = computeInventoryMetrics(baseBusiness, productsT7B, movementsT7, { referenceDate: refDate });
  assertEquals(resT7B.productMetrics[0].estimatedDaysOfStockRemaining, 0, 'Días estimados para producto agotado es 0 (no Infinity ni NaN)');

  // Caso: Producto sin salidas
  const productsT7C: ProductInput[] = [
    { id: 'p_idle', name: 'Sin salidas', sku: null, category: null, basePrice: 10, stockQuantity: 50, createdAt: refDate },
  ];
  const resT7C = computeInventoryMetrics(baseBusiness, productsT7C, [], { referenceDate: refDate });
  assertEquals(resT7C.productMetrics[0].estimatedDaysOfStockRemaining, null, 'Días estimados es null cuando velocidad es 0 (evita Infinity)');

  // ----------------------------------------------------
  // TEST 8: Indicadores de historial insuficiente y fechas inválidas
  // ----------------------------------------------------
  console.log('\nTest 8: Historial insuficiente, fechas inválidas y rango de datos');
  const movementsT8: MovementInput[] = [
    { id: 'mi1', productId: 'p1', type: 'ENTRY', quantity: 10, note: null, date: new Date('FechaInvalida') }, // Inválida
    { id: 'mi2', productId: 'p1', type: 'ENTRY', quantity: 10, note: null, date: new Date(refDate.getTime() - 2 * msInDay) },
  ];

  const resT8 = computeInventoryMetrics(baseBusiness, [productsT7[0]], movementsT8, { referenceDate: refDate });
  assertEquals(resT8.historyRange.totalMovementsRecorded, 1, 'Movimiento con fecha inválida fue ignorado con seguridad');
  assertEquals(resT8.historySufficiency.level, 'MINIMAL', 'Nivel es MINIMAL (solo entradas, sin salidas)');
  assertEquals(resT8.historySufficiency.canEstimateTrends, false, 'No permite estimar tendencias con datos mínimos');
  assert(resT8.historySufficiency.reason.includes('no hay salidas históricas'), 'Razón explica ausencia de salidas');

  // Caso: Historial SUFFICIENT (35 días con múltiples salidas)
  const movementsSufficient: MovementInput[] = [
    { id: 'm_old', productId: 'p1', type: 'EXIT', quantity: 5, note: null, date: new Date(refDate.getTime() - 35 * msInDay) },
    { id: 'm_mid1', productId: 'p1', type: 'EXIT', quantity: 5, note: null, date: new Date(refDate.getTime() - 25 * msInDay) },
    { id: 'm_mid2', productId: 'p1', type: 'EXIT', quantity: 5, note: null, date: new Date(refDate.getTime() - 18 * msInDay) },
    { id: 'm_mid3', productId: 'p1', type: 'EXIT', quantity: 5, note: null, date: new Date(refDate.getTime() - 10 * msInDay) },
    { id: 'm_mid4', productId: 'p1', type: 'EXIT', quantity: 5, note: null, date: new Date(refDate.getTime() - 5 * msInDay) },
    { id: 'm_mid5', productId: 'p1', type: 'EXIT', quantity: 5, note: null, date: new Date(refDate.getTime() - 1 * msInDay) },
  ];
  const resSufficient = computeInventoryMetrics(baseBusiness, [productsT7[0]], movementsSufficient, { referenceDate: refDate });
  assertEquals(resSufficient.historySufficiency.level, 'SUFFICIENT', 'Nivel es SUFFICIENT con > 30 días y 6 salidas');
  assertEquals(resSufficient.historySufficiency.canEstimateTrends, true, 'canEstimateTrends es true');

  // ----------------------------------------------------
  // TEST 9: Integración en vivo con SQLite vía Prisma (Solo lectura)
  // ----------------------------------------------------
  console.log('\nTest 9: Integración con base de datos real SQLite vía Prisma (Solo lectura)');
  const liveResult = await getInventoryAnalytics();
  assert(liveResult !== null && typeof liveResult === 'object', 'getInventoryAnalytics devuelve un objeto');
  assert(typeof liveResult.business.name === 'string', `Nombre de negocio cargado: "${liveResult.business.name}"`);
  assert(liveResult.stockSummary.totalProducts >= 0, `Total de productos en BD: ${liveResult.stockSummary.totalProducts}`);
  assert(liveResult.historyRange.totalMovementsRecorded >= 0, `Total de movimientos en BD: ${liveResult.historyRange.totalMovementsRecorded}`);
  assert(Array.isArray(liveResult.productMetrics), 'productMetrics es un arreglo válido');
  assert(liveResult.periods.last7Days.periodDays === 7, 'Período 7 días presente');
  assert(liveResult.periods.last30Days.periodDays === 30, 'Período 30 días presente');
  assert(['NONE', 'MINIMAL', 'PARTIAL', 'SUFFICIENT'].includes(liveResult.historySufficiency.level), `Nivel de suficiencia de BD real: ${liveResult.historySufficiency.level}`);
  console.log(`  ℹ Razón de suficiencia en BD real: "${liveResult.historySufficiency.reason}"`);

  console.log('\n====================================================');
  console.log(`RESULTADOS: ${passed} pruebas superadas, ${failed} fallos`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests()
  .catch(err => {
    console.error('Error fatal en ejecución de pruebas:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
