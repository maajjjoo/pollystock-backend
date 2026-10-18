import prisma from '../config/db';

export const getProducts = async (businessId: string, search?: string) => {
  const whereClause: any = { businessId };
  if (search) {
    whereClause.name = { contains: search };
  }
  return await prisma.product.findMany({
    where: whereClause,
    orderBy: { name: 'asc' },
  });
};

export const getProductById = async (businessId: string, id: string) => {
  return await prisma.product.findFirst({
    where: { id, businessId },
  });
};

export const createProduct = async (businessId: string, data: any) => {
  return await prisma.product.create({
    data: {
      ...data,
      businessId,
    },
  });
};

export const updateProduct = async (businessId: string, id: string, data: any) => {
  return await prisma.product.update({
    where: { id, businessId },
    data,
  });
};

export const deleteProduct = async (businessId: string, id: string) => {
  // Check for existing movements
  const movementsCount = await prisma.movement.count({
    where: { productId: id },
  });

  if (movementsCount > 0) {
    throw new Error('PRODUCT_HAS_MOVEMENTS');
  }

  return await prisma.product.delete({
    where: { id, businessId },
  });
};

const parseOptionsList = (raw: any): string[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(String).map(s => s.trim()).filter(Boolean);
      } catch {}
    }
    return trimmed.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
};

export const sanitizeDynamicAttributes = (submittedAttributes: any, definitions: any[]): Record<string, any> => {
  if (!submittedAttributes || typeof submittedAttributes !== 'object') {
    return {};
  }
  const defById = new Map<string, any>(definitions.map(d => [d.id, d]));
  const defByName = new Map<string, any>(definitions.map(d => [d.name.toLowerCase().trim(), d]));
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(submittedAttributes)) {
    const trimmedKey = key.trim();
    let def = defById.get(trimmedKey);
    if (!def) {
      def = defByName.get(trimmedKey.toLowerCase());
    }
    if (def) {
      sanitized[def.id] = value;
    }
  }
  return sanitized;
};

export const validateDynamicAttributes = (
  submittedAttributes: any, 
  definitions: any[],
  existingAttributes?: Record<string, any>
) => {
  if (!submittedAttributes || typeof submittedAttributes !== 'object') {
    return;
  }

  // 1. Check required attributes
  for (const def of definitions) {
    if (def.isRequired) {
      const submittedVal = submittedAttributes[def.id];
      const isSubmittedEmpty = submittedVal === undefined || submittedVal === null || String(submittedVal).trim() === '';

      if (isSubmittedEmpty) {
        // If updating an existing product that originally lacked this attribute, do not block editing
        if (existingAttributes) {
          const hadValue = (existingAttributes[def.id] !== undefined && existingAttributes[def.id] !== null && String(existingAttributes[def.id]).trim() !== '') ||
                           (existingAttributes[def.name] !== undefined && existingAttributes[def.name] !== null && String(existingAttributes[def.name]).trim() !== '');
          if (!hadValue) {
            continue;
          }
        }
        throw new Error('Required attribute missing: ' + def.name);
      }
    }
  }

  // 2. Validate submitted values
  for (const key of Object.keys(submittedAttributes)) {
    const def = definitions.find(d => d.id === key);
    if (!def) {
      // Skip unknown or deprecated attribute definitions
      continue;
    }

    const value = submittedAttributes[key];
    if (value === undefined || value === null || String(value).trim() === '') {
      continue;
    }

    switch (def.dataType) {
      case 'TEXT':
        if (typeof value !== 'string') throw new Error('Attribute ' + def.name + ' must be text');
        break;
      case 'NUMBER':
        if (isNaN(Number(value))) throw new Error('Attribute ' + def.name + ' must be a number');
        break;
      case 'DATE':
        if (isNaN(Date.parse(String(value)))) throw new Error('Attribute ' + def.name + ' must be a valid date');
        break;
      case 'BOOLEAN':
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          throw new Error('Attribute ' + def.name + ' must be a boolean');
        }
        break;
      case 'OPTIONS':
        const options = parseOptionsList(def.options);
        if (options.length > 0 && !options.includes(String(value).trim())) {
          throw new Error('Attribute ' + def.name + ' value ' + value + ' is not a valid option');
        }
        break;
      default:
        throw new Error('Unsupported data type ' + def.dataType);
    }
  }
};

