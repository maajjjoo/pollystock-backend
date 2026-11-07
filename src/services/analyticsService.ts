import prisma from '../config/db';

export interface BusinessConfigInput {
  id: string;
  name: string;
  businessType: string;
  defaultUnit: string;
  useMinStock: boolean;
  minStock: number | null;
}

export interface ProductInput {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  basePrice: number;
  stockQuantity: number;
  createdAt: Date;
}

export interface MovementInput {
  id: string;
  productId: string;
  type: string;
  quantity: number;
  note: string | null;
  date: Date;
}

export interface AnalyticsOptions {
  referenceDate?: Date;
}

export type HistorySufficiencyLevel = 'NONE' | 'MINIMAL' | 'PARTIAL' | 'SUFFICIENT';

export interface StockSummary {
  totalProducts: number;
  totalUnitsInStock: number;
  totalInventoryValue: number;
  inStockProductsCount: number;
}

export interface StockoutMetrics {
  outOfStockCount: number;
  outOfStockProducts: Array<{
    id: string;
    name: string;
    sku: string | null;
    category: string | null;
    stockQuantity: number;
  }>;
}

export interface MinStockMetrics {
  isMinStockEnabled: boolean;
  minStockThreshold: number | null;
  lowStockCount: number;
  lowStockProducts: Array<{
    id: string;
    name: string;
    sku: string | null;
    category: string | null;
    stockQuantity: number;
    threshold: number;
    deficit: number;
  }>;
}

export interface PeriodMovementMetrics {
  periodDays: number;
  startDate: string;
  endDate: string;
  entryMovementsCount: number;
  exitMovementsCount: number;
  entryUnitsTotal: number;
  exitUnitsTotal: number;
  netUnitsBalance: number;
}

export interface ProductMovementMetric {
  productId: string;
  name: string;
  sku: string | null;
  category: string | null;
  currentStock: number;
  exitUnits7d: number;
  exitMovementsCount7d: number;
  exitUnits30d: number;
  exitMovementsCount30d: number;
  entryUnits7d: number;
  entryUnits30d: number;
  averageDailyExitRate30d: number;
  estimatedDaysOfStockRemaining: number | null;
  hasSufficientDataForEstimate: boolean;
  hasNoExitInLast30Days: boolean;
}

export interface TopProductMetric {
  productId: string;
  name: string;
  sku: string | null;
  category: string | null;
  currentStock: number;
  exitUnits: number;
  exitMovementsCount: number;
}

export interface InactiveProductMetric {
  productId: string;
  name: string;
  sku: string | null;
  category: string | null;
  currentStock: number;
  hasEverExited: boolean;
  lastExitDate: string | null;
}

export interface MovementHistoryRange {
  firstMovementDate: string | null;
  lastMovementDate: string | null;
  dataSpanDays: number;
  daysSinceLastMovement: number | null;
  totalMovementsRecorded: number;
}

export interface HistorySufficiency {
  level: HistorySufficiencyLevel;
  hasProducts: boolean;
  hasMovements: boolean;
  hasExitMovements: boolean;
  reason: string;
  canEstimateTrends: boolean;
  canEstimateReplenishment: boolean;
}

export interface InventoryAnalytics {
  business: {
    id: string;
    name: string;
    businessType: string;
    defaultUnit: string;
  };
  generatedAt: string;
  stockSummary: StockSummary;
  stockoutMetrics: StockoutMetrics;
  minStockMetrics: MinStockMetrics;
  periods: {
    last7Days: PeriodMovementMetrics;
    last30Days: PeriodMovementMetrics;
  };
  topExitedProducts: {
    last7Days: TopProductMetric[];
    last30Days: TopProductMetric[];
  };
  productsWithoutExitLast30Days: {
    count: number;
    products: InactiveProductMetric[];
  };
  productMetrics: ProductMovementMetric[];
  historyRange: MovementHistoryRange;
  historySufficiency: HistorySufficiency;
}

const safeNumber = (val: any): number => {
  if (val === null || val === undefined) return 0;
  const num = Number(val);
  return isNaN(num) || !isFinite(num) ? 0 : num;
};

const roundTo = (num: number, decimals: number = 2): number => {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
};

/**
 * Pure calculation function for deterministic inventory analytics.
 * Does not perform database operations, enabling comprehensive unit testing.
 */
export function computeInventoryMetrics(
  business: BusinessConfigInput,
  products: ProductInput[],
  movements: MovementInput[],
  options?: AnalyticsOptions
): InventoryAnalytics {
  const referenceDate = options?.referenceDate instanceof Date && !isNaN(options.referenceDate.getTime())
    ? options.referenceDate
    : new Date();

  const refTime = referenceDate.getTime();
  const msInDay = 24 * 60 * 60 * 1000;
  const cutoff7d = new Date(refTime - 7 * msInDay);
  const cutoff30d = new Date(refTime - 30 * msInDay);

  // 1. Current stock summary & out of stock & min stock
  let totalUnitsInStock = 0;
  let totalInventoryValue = 0;
  let inStockProductsCount = 0;

  const outOfStockProducts: StockoutMetrics['outOfStockProducts'] = [];
  const lowStockProducts: MinStockMetrics['lowStockProducts'] = [];

  const isMinStockEnabled = Boolean(
    business.useMinStock &&
    business.minStock !== null &&
    business.minStock !== undefined &&
    safeNumber(business.minStock) > 0
  );
  const minStockThreshold = isMinStockEnabled ? safeNumber(business.minStock) : null;

  for (const p of products) {
    const stock = safeNumber(p.stockQuantity);
    const price = safeNumber(p.basePrice);

    if (stock <= 0) {
      outOfStockProducts.push({
        id: p.id,
        name: p.name,
        sku: p.sku,
        category: p.category,
        stockQuantity: stock,
      });
    } else {
      inStockProductsCount++;
      totalUnitsInStock += stock;
      totalInventoryValue += stock * price;
      if (isMinStockEnabled && minStockThreshold !== null && stock <= minStockThreshold) {
        lowStockProducts.push({
          id: p.id,
          name: p.name,
          sku: p.sku,
          category: p.category,
          stockQuantity: stock,
          threshold: minStockThreshold,
          deficit: roundTo(minStockThreshold - stock, 2),
        });
      }
    }
  }

  // 2. Movement history range & chronological analysis
  const validMovements = movements.filter(m => m.date instanceof Date && !isNaN(m.date.getTime()));
  validMovements.sort((a, b) => a.date.getTime() - b.date.getTime());

  const totalMovementsRecorded = validMovements.length;
  const firstMovement = totalMovementsRecorded > 0 ? validMovements[0] : null;
  const lastMovement = totalMovementsRecorded > 0 ? validMovements[totalMovementsRecorded - 1] : null;

  const firstMovementDate = firstMovement ? firstMovement.date.toISOString() : null;
  const lastMovementDate = lastMovement ? lastMovement.date.toISOString() : null;

  let dataSpanDays = 0;
  let daysSinceLastMovement: number | null = null;

  if (firstMovement && lastMovement) {
    const spanMs = Math.max(0, lastMovement.date.getTime() - firstMovement.date.getTime());
    dataSpanDays = roundTo(spanMs / msInDay, 1);
    const sinceLastMs = Math.max(0, refTime - lastMovement.date.getTime());
    daysSinceLastMovement = roundTo(sinceLastMs / msInDay, 1);
  }

  // 3. Aggregate movements by window (7d, 30d) and by product
  let entryMovements7d = 0;
  let exitMovements7d = 0;
  let entryUnits7d = 0;
  let exitUnits7d = 0;

  let entryMovements30d = 0;
  let exitMovements30d = 0;
  let entryUnits30d = 0;
  let exitUnits30d = 0;

  // Track per-product metrics
  const productExitUnits7d = new Map<string, number>();
  const productExitCount7d = new Map<string, number>();
  const productEntryUnits7d = new Map<string, number>();

  const productExitUnits30d = new Map<string, number>();
  const productExitCount30d = new Map<string, number>();
  const productEntryUnits30d = new Map<string, number>();

  const productEverExited = new Set<string>();
  const productLastExitDate = new Map<string, Date>();

  for (const m of validMovements) {
    const mTime = m.date.getTime();
    const qty = Math.max(0, safeNumber(m.quantity));
    const isEntry = m.type === 'ENTRY' || m.type === 'IN';
    const isExit = m.type === 'EXIT' || m.type === 'OUT';

    if (isExit) {
      productEverExited.add(m.productId);
      const prevDate = productLastExitDate.get(m.productId);
      if (!prevDate || m.date > prevDate) {
        productLastExitDate.set(m.productId, m.date);
      }
    }

    // Check 30d window: [cutoff30d, referenceDate]
    if (mTime >= cutoff30d.getTime() && mTime <= refTime) {
      if (isEntry) {
        entryMovements30d++;
        entryUnits30d += qty;
        productEntryUnits30d.set(m.productId, (productEntryUnits30d.get(m.productId) || 0) + qty);
      } else if (isExit) {
        exitMovements30d++;
        exitUnits30d += qty;
        productExitUnits30d.set(m.productId, (productExitUnits30d.get(m.productId) || 0) + qty);
        productExitCount30d.set(m.productId, (productExitCount30d.get(m.productId) || 0) + 1);
      }
    }

    // Check 7d window: [cutoff7d, referenceDate]
    if (mTime >= cutoff7d.getTime() && mTime <= refTime) {
      if (isEntry) {
        entryMovements7d++;
        entryUnits7d += qty;
        productEntryUnits7d.set(m.productId, (productEntryUnits7d.get(m.productId) || 0) + qty);
      } else if (isExit) {
        exitMovements7d++;
        exitUnits7d += qty;
        productExitUnits7d.set(m.productId, (productExitUnits7d.get(m.productId) || 0) + qty);
        productExitCount7d.set(m.productId, (productExitCount7d.get(m.productId) || 0) + 1);
      }
    }
  }

  // 4. Detailed Product Metrics
  const productMetrics: ProductMovementMetric[] = products.map(p => {
    const currentStock = safeNumber(p.stockQuantity);
    const pExitUnits7d = roundTo(productExitUnits7d.get(p.id) || 0, 2);
    const pExitCount7d = productExitCount7d.get(p.id) || 0;
    const pEntryUnits7d = roundTo(productEntryUnits7d.get(p.id) || 0, 2);

    const pExitUnits30d = roundTo(productExitUnits30d.get(p.id) || 0, 2);
    const pExitCount30d = productExitCount30d.get(p.id) || 0;
    const pEntryUnits30d = roundTo(productEntryUnits30d.get(p.id) || 0, 2);

    // Daily rate over 30 days
    const averageDailyExitRate30d = roundTo(pExitUnits30d / 30, 2);

    // Days remaining estimation
    let estimatedDaysOfStockRemaining: number | null = null;
    if (currentStock <= 0) {
      estimatedDaysOfStockRemaining = 0;
    } else if (averageDailyExitRate30d > 0) {
      estimatedDaysOfStockRemaining = roundTo(currentStock / averageDailyExitRate30d, 1);
    }

    // Reliability check: needs at least 2 exits in 30d and data span of >= 3 days
    const hasSufficientDataForEstimate = Boolean(
      pExitCount30d >= 2 && dataSpanDays >= 3
    );

    return {
      productId: p.id,
      name: p.name,
      sku: p.sku,
      category: p.category,
      currentStock,
      exitUnits7d: pExitUnits7d,
      exitMovementsCount7d: pExitCount7d,
      exitUnits30d: pExitUnits30d,
      exitMovementsCount30d: pExitCount30d,
      entryUnits7d: pEntryUnits7d,
      entryUnits30d: pEntryUnits30d,
      averageDailyExitRate30d,
      estimatedDaysOfStockRemaining,
      hasSufficientDataForEstimate,
      hasNoExitInLast30Days: pExitCount30d === 0,
    };
  });

  // 5. Top Exited Products (7d and 30d)
  const topExitedProducts7d: TopProductMetric[] = productMetrics
    .filter(p => p.exitUnits7d > 0)
    .sort((a, b) => b.exitUnits7d - a.exitUnits7d || b.exitMovementsCount7d - a.exitMovementsCount7d)
    .slice(0, 5)
    .map(p => ({
      productId: p.productId,
      name: p.name,
      sku: p.sku,
      category: p.category,
      currentStock: p.currentStock,
      exitUnits: p.exitUnits7d,
      exitMovementsCount: p.exitMovementsCount7d,
    }));

  const topExitedProducts30d: TopProductMetric[] = productMetrics
    .filter(p => p.exitUnits30d > 0)
    .sort((a, b) => b.exitUnits30d - a.exitUnits30d || b.exitMovementsCount30d - a.exitMovementsCount30d)
    .slice(0, 5)
    .map(p => ({
      productId: p.productId,
      name: p.name,
      sku: p.sku,
      category: p.category,
      currentStock: p.currentStock,
      exitUnits: p.exitUnits30d,
      exitMovementsCount: p.exitMovementsCount30d,
    }));

  // 6. Products with no exit in last 30 days
  const inactiveProducts: InactiveProductMetric[] = productMetrics
    .filter(p => p.hasNoExitInLast30Days)
    .map(p => {
      const lastDate = productLastExitDate.get(p.productId);
      return {
        productId: p.productId,
        name: p.name,
        sku: p.sku,
        category: p.category,
        currentStock: p.currentStock,
        hasEverExited: productEverExited.has(p.productId),
        lastExitDate: lastDate ? lastDate.toISOString() : null,
      };
    });

  // 7. History sufficiency evaluation
  const hasProducts = products.length > 0;
  const hasMovements = totalMovementsRecorded > 0;
  const hasExitMovements = productEverExited.size > 0;

  let level: HistorySufficiencyLevel = 'NONE';
  let reason = '';
  let canEstimateTrends = false;
  let canEstimateReplenishment = false;

  if (!hasProducts) {
    level = 'NONE';
    reason = 'No hay productos registrados en el inventario.';
  } else if (!hasMovements) {
    level = 'NONE';
    reason = 'No se han registrado movimientos de inventario todavía. Se deben registrar entradas o salidas.';
  } else if (!hasExitMovements) {
    level = 'MINIMAL';
    reason = 'Solo existen entradas registradas; no hay salidas históricas para proyectar consumo o velocidad de inventario.';
  } else if (exitMovements30d < 3 || dataSpanDays < 7) {
    level = 'MINIMAL';
    reason = 'Historial inicial insuficiente para proyectar rotación confiable (menos de 3 salidas o menos de 7 días de seguimiento).';
  } else if (dataSpanDays < 30 || exitMovements30d < 5) {
    level = 'PARTIAL';
    reason = 'Historial parcial (más de 7 días de datos pero menos de un mes completo de actividad continua o salidas frecuentes).';
    canEstimateReplenishment = true;
  } else {
    level = 'SUFFICIENT';
    reason = 'Historial representativo con al menos 30 días de actividad y registros regulares de salida.';
    canEstimateTrends = true;
    canEstimateReplenishment = true;
  }

  return {
    business: {
      id: business.id,
      name: business.name,
      businessType: business.businessType,
      defaultUnit: business.defaultUnit,
    },
    generatedAt: referenceDate.toISOString(),
    stockSummary: {
      totalProducts: products.length,
      totalUnitsInStock: roundTo(totalUnitsInStock, 2),
      totalInventoryValue: roundTo(totalInventoryValue, 2),
      inStockProductsCount,
    },
    stockoutMetrics: {
      outOfStockCount: outOfStockProducts.length,
      outOfStockProducts,
    },
    minStockMetrics: {
      isMinStockEnabled,
      minStockThreshold,
      lowStockCount: lowStockProducts.length,
      lowStockProducts,
    },
    periods: {
      last7Days: {
        periodDays: 7,
        startDate: cutoff7d.toISOString(),
        endDate: referenceDate.toISOString(),
        entryMovementsCount: entryMovements7d,
        exitMovementsCount: exitMovements7d,
        entryUnitsTotal: roundTo(entryUnits7d, 2),
        exitUnitsTotal: roundTo(exitUnits7d, 2),
        netUnitsBalance: roundTo(entryUnits7d - exitUnits7d, 2),
      },
      last30Days: {
        periodDays: 30,
        startDate: cutoff30d.toISOString(),
        endDate: referenceDate.toISOString(),
        entryMovementsCount: entryMovements30d,
        exitMovementsCount: exitMovements30d,
        entryUnitsTotal: roundTo(entryUnits30d, 2),
        exitUnitsTotal: roundTo(exitUnits30d, 2),
        netUnitsBalance: roundTo(entryUnits30d - exitUnits30d, 2),
      },
    },
    topExitedProducts: {
      last7Days: topExitedProducts7d,
      last30Days: topExitedProducts30d,
    },
    productsWithoutExitLast30Days: {
      count: inactiveProducts.length,
      products: inactiveProducts,
    },
    productMetrics,
    historyRange: {
      firstMovementDate,
      lastMovementDate,
      dataSpanDays,
      daysSinceLastMovement,
      totalMovementsRecorded,
    },
    historySufficiency: {
      level,
      hasProducts,
      hasMovements,
      hasExitMovements,
      reason,
      canEstimateTrends,
      canEstimateReplenishment,
    },
  };
}

/**
 * Service function that reads live data from SQLite via Prisma and computes
 * deterministic inventory analytics for the requested business.
 */
export const getInventoryAnalytics = async (
  businessId: string,
  options?: AnalyticsOptions
): Promise<InventoryAnalytics> => {
  // Siempre el negocio del usuario autenticado: sin id no se analiza ningún negocio.
  if (!businessId) {
    throw new Error('NO_BUSINESS');
  }
  const targetBusiness: any = await prisma.business.findUnique({
    where: { id: businessId },
  });

  if (!targetBusiness) {
    throw new Error('NO_BUSINESS');
  }

  const [productsRaw, movementsRaw] = await Promise.all([
    prisma.product.findMany({
      where: { businessId: targetBusiness.id },
      orderBy: { name: 'asc' },
    }),
    prisma.movement.findMany({
      where: { product: { businessId: targetBusiness.id } },
      orderBy: { date: 'asc' },
    }),
  ]);

  const businessInput: BusinessConfigInput = {
    id: targetBusiness.id,
    name: targetBusiness.name,
    businessType: targetBusiness.businessType,
    defaultUnit: targetBusiness.defaultUnit,
    useMinStock: Boolean(targetBusiness.useMinStock),
    minStock: targetBusiness.minStock !== null ? safeNumber(targetBusiness.minStock) : null,
  };

  const productsInput: ProductInput[] = productsRaw.map(p => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category,
    basePrice: safeNumber(p.basePrice),
    stockQuantity: safeNumber(p.stockQuantity),
    createdAt: p.createdAt,
  }));

  const movementsInput: MovementInput[] = movementsRaw.map(m => ({
    id: m.id,
    productId: m.productId,
    type: m.type,
    quantity: safeNumber(m.quantity),
    note: m.note,
    date: m.date,
  }));

  return computeInventoryMetrics(businessInput, productsInput, movementsInput, options);
};
