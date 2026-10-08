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

export const validateDynamicAttributes = (submittedAttributes: any, definitions: any[]) => {
  if (!submittedAttributes || typeof submittedAttributes !== 'object') {
    return;
  }

  // 1. Check required attributes
  for (const def of definitions) {
    if (def.isRequired && (submittedAttributes[def.id] === undefined || submittedAttributes[def.id] === null || submittedAttributes[def.id] === '')) {
      throw new Error('Required attribute missing: ' + def.name);
    }
  }

  // 2. Validate submitted values
  for (const key of Object.keys(submittedAttributes)) {
    const def = definitions.find(d => d.id === key);
    if (!def) {
      throw new Error('Unknown attribute ID: ' + key);
    }

    const value = submittedAttributes[key];
    if (value === undefined || value === null || value === '') {
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
        if (isNaN(Date.parse(value))) throw new Error('Attribute ' + def.name + ' must be a valid date');
        break;
      case 'BOOLEAN':
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          throw new Error('Attribute ' + def.name + ' must be a boolean');
        }
        break;
      case 'OPTIONS':
        let options = [];
        try {
          options = JSON.parse(def.options || '[]');
        } catch(e) {}
        if (!options.includes(value)) {
          throw new Error('Attribute ' + def.name + ' value ' + value + ' is not a valid option');
        }
        break;
      default:
        throw new Error('Unsupported data type ' + def.dataType);
    }
  }
};
