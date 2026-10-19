import { InventoryAnalytics } from './analyticsService';

export const SYSTEM_INSTRUCTION = `Eres PollyStock AI, el asistente inteligente y consultivo de gestión de inventarios para la aplicación PollyStock.

DIRECTRICES OBLIGATORIAS Y REGLAS DE COMPORTAMIENTO:
1. ROL ESTRICTAMENTE CONSULTIVO:
   - Tu función es analizar, responder preguntas y brindar recomendaciones sobre el inventario actual.
   - No puedes crear, modificar ni eliminar productos, alterar existencias ni registrar entradas o salidas.
   - Todas las recomendaciones de reabastecimiento o ajuste deben ser validadas y ejecutadas manualmente por el usuario.

2. VERACIDAD Y FIDELIDAD A LOS DATOS (GROUNDING ABSOLUTO):
   - Basa todas tus afirmaciones, cifras y recomendaciones EXCLUSIVAMENTE en los datos reales del inventario provistos en el contexto.
   - NUNCA inventes nombres de productos, códigos SKU, categorías, precios, cantidades de stock, fechas ni movimientos.
   - Si el usuario pregunta por un producto o dato que no se encuentra en el inventario provisto, debes reconocer claramente esa limitación en lugar de inventar o suponer.

3. DOMINIO DEL NEGOCIO Y ADAPTABILIDAD:
   - PollyStock está diseñado para cualquier tipo de negocio (moda, tecnología, víveres, ferretería, papelería, etc.).
   - No asumas que el negocio vende alimentos ni que los productos son perecederos, a menos que el tipo de negocio o la categoría lo indiquen expresamente.
   - Respeta siempre la unidad de medida configurada para el negocio (ej. unidades, kg, piezas, litros).

4. PRECISIÓN CONCEPTUAL:
   - Las ENTRADAS (ENTRY) corresponden a compras o abastecimiento; NUNCA las confundas con ventas o consumo.
   - Las SALIDAS (EXIT) representan ventas, consumo o mermas.
   - Si un producto no registra salidas en los últimos 30 días, descríbelo con precisión como "sin salidas registradas en los últimos 30 días". NO afirmes categóricamente que es un producto obsoleto o de baja rotación general si no hay datos históricos suficientes.

5. SUFICIENCIA HISTÓRICA Y PROYECCIONES:
   - Consulta el "Nivel de Suficiencia Histórica" reportado por el motor analítico.
   - Si el nivel es NONE o MINIMAL, NO presentes estimaciones ni proyecciones de demanda como hechos o certezas; advierte con claridad que el historial de movimientos es insuficiente y explica la razón indicada por el sistema.
   - Si el nivel es PARTIAL o SUFFICIENT, puedes formular proyecciones basadas en el consumo promedio diario observado, advirtiendo que son estimaciones sujetas a variabilidad comercial.

6. SEGURIDAD Y FORMATO:
   - Responde siempre en español claro, profesional, conciso y amigable.
   - Emplea listas con viñetas cuando detalles productos para facilitar la lectura en dispositivos móviles.
   - Nunca reveles claves de API, secretos de configuración ni detalles de arquitectura interna del servidor.`;

export function buildInventoryContextSummary(analytics: InventoryAnalytics): string {
  const {
    business,
    stockSummary,
    stockoutMetrics,
    minStockMetrics,
    periods,
    topExitedProducts,
    productsWithoutExitLast30Days,
    productMetrics,
    historyRange,
    historySufficiency,
  } = analytics;

  const sections: string[] = [];

  // 1. Datos del negocio
  sections.push(`### NEGOCIO
- Nombre: "${business.name}"
- Tipo de comercio: ${business.businessType}
- Unidad de medida estándar: ${business.defaultUnit}`);

  // 2. Resumen cuantitativo de existencias
  sections.push(`### RESUMEN GENERAL DE STOCK
- Total de productos registrados: ${stockSummary.totalProducts}
- Unidades físicas disponibles en total: ${stockSummary.totalUnitsInStock} ${business.defaultUnit}
- Valoración monetaria total del inventario disponible: $${stockSummary.totalInventoryValue.toLocaleString('es-CO')}
- Productos con existencias disponibles (> 0): ${stockSummary.inStockProductsCount}`);

  // 3. Situación de agotados y stock bajo
  if (stockoutMetrics.outOfStockCount > 0) {
    const list = stockoutMetrics.outOfStockProducts
      .map(p => `  * ${p.name} (SKU: ${p.sku || 'N/A'}, Categoría: ${p.category || 'General'}) - Stock actual: ${p.stockQuantity}`)
      .join('\n');
    sections.push(`### PRODUCTOS AGOTADOS (${stockoutMetrics.outOfStockCount})
${list}`);
  } else {
    sections.push(`### PRODUCTOS AGOTADOS: 0 (No hay productos agotados actualmente)`);
  }

  if (minStockMetrics.isMinStockEnabled) {
    if (minStockMetrics.lowStockCount > 0) {
      const list = minStockMetrics.lowStockProducts
        .map(p => `  * ${p.name} (SKU: ${p.sku || 'N/A'}) - Stock actual: ${p.stockQuantity}, Umbral mínimo: ${p.threshold}, Déficit: ${p.deficit} ${business.defaultUnit}`)
        .join('\n');
      sections.push(`### PRODUCTOS CON STOCK BAJO (Control de stock mínimo activo: umbral ${minStockMetrics.minStockThreshold} ${business.defaultUnit})
- Total bajo umbral: ${minStockMetrics.lowStockCount}
${list}`);
    } else {
      sections.push(`### PRODUCTOS CON STOCK BAJO: 0 (Todos los productos disponibles cumplen el umbral mínimo de ${minStockMetrics.minStockThreshold} ${business.defaultUnit})`);
    }
  } else {
    sections.push(`### CONTROL DE STOCK MÍNIMO: Deshabilitado en la configuración del comercio.`);
  }

  // 4. Actividad reciente en 7 y 30 días
  const p7 = periods.last7Days;
  const p30 = periods.last30Days;
  sections.push(`### ACTIVIDAD DE MOVIMIENTOS RECIENTES
- Últimos 7 días:
  * Entradas: ${p7.entryMovementsCount} registros (${p7.entryUnitsTotal} ${business.defaultUnit} ingresadas)
  * Salidas: ${p7.exitMovementsCount} registros (${p7.exitUnitsTotal} ${business.defaultUnit} egresadas)
  * Balance neto: ${p7.netUnitsBalance > 0 ? '+' : ''}${p7.netUnitsBalance} ${business.defaultUnit}
- Últimos 30 días:
  * Entradas: ${p30.entryMovementsCount} registros (${p30.entryUnitsTotal} ${business.defaultUnit} ingresadas)
  * Salidas: ${p30.exitMovementsCount} registros (${p30.exitUnitsTotal} ${business.defaultUnit} egresadas)
  * Balance neto: ${p30.netUnitsBalance > 0 ? '+' : ''}${p30.netUnitsBalance} ${business.defaultUnit}`);

  // 5. Top productos con salidas
  if (topExitedProducts.last30Days.length > 0) {
    const top30 = topExitedProducts.last30Days
      .map((p, idx) => `  ${idx + 1}. ${p.name}: ${p.exitUnits} ${business.defaultUnit} retiradas en ${p.exitMovementsCount} movimiento(s) (Stock actual: ${p.currentStock})`)
      .join('\n');
    sections.push(`### TOP PRODUCTOS CON MAYORES SALIDAS (Últimos 30 días)
${top30}`);
  } else {
    sections.push(`### TOP PRODUCTOS CON SALIDAS: No se han registrado movimientos de salida en los últimos 30 días.`);
  }

  // 6. Productos sin salidas en 30 días
  if (productsWithoutExitLast30Days.count > 0) {
    const inactives = productsWithoutExitLast30Days.products
      .map(p => `  * ${p.name} (Stock: ${p.currentStock}) - ¿Tuvo salidas previas históricas?: ${p.hasEverExited ? `Sí (última salida: ${p.lastExitDate ? p.lastExitDate.substring(0, 10) : 'Fecha no registrada'})` : 'No, nunca ha registrado salidas'}`)
      .join('\n');
    sections.push(`### PRODUCTOS SIN SALIDAS EN LOS ÚLTIMOS 30 DÍAS (${productsWithoutExitLast30Days.count})
${inactives}`);
  } else {
    sections.push(`### PRODUCTOS SIN SALIDAS: Todos los productos activos han tenido al menos una salida en los últimos 30 días.`);
  }

  // 7. Velocidad y estimaciones de cobertura de stock
  const estimates = productMetrics
    .filter(p => p.currentStock > 0 && p.exitUnits30d > 0)
    .map(p => {
      const days = p.estimatedDaysOfStockRemaining !== null ? `${p.estimatedDaysOfStockRemaining} días` : 'No calculable';
      return `  * ${p.name}: Ritmo promedio = ${p.averageDailyExitRate30d} ${business.defaultUnit}/día | Cobertura estimada = ${days} de stock restante`;
    });

  if (estimates.length > 0) {
    sections.push(`### VELOCIDAD DIARIA Y COBERTURA ESTIMADA DE STOCK
${estimates.join('\n')}`);
  }

  // 8. Historial y suficiencia de datos
  sections.push(`### EVALUACIÓN DE SUFICIENCIA DE DATOS HISTÓRICOS
- Rango de movimientos registrados: ${historyRange.totalMovementsRecorded} movimientos en total
- Primer movimiento registrado: ${historyRange.firstMovementDate ? historyRange.firstMovementDate.substring(0, 10) : 'Ninguno'}
- Último movimiento registrado: ${historyRange.lastMovementDate ? historyRange.lastMovementDate.substring(0, 10) : 'Ninguno'}
- Días de seguimiento histórico: ${historyRange.dataSpanDays ?? 0} días
- Nivel de suficiencia analítica: ${historySufficiency.level}
- Diagnóstico del motor: "${historySufficiency.reason}"
- ¿Permite proyectar tendencias con fiabilidad?: ${historySufficiency.canEstimateTrends ? 'SÍ' : 'NO'}
- ¿Permite estimar necesidades de reabastecimiento?: ${historySufficiency.canEstimateReplenishment ? 'SÍ' : 'NO'}`);

  return sections.join('\n\n');
}
