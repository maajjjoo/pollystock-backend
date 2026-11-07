import prisma from '../config/db';

const EDITABLE_FIELDS = [
  'name',
  'businessType',
  'productType',
  'defaultUnit',
  'useCategories',
  'useProductCodes',
  'useMinStock',
  'minStock',
  'useExpirationDates',
  'theme',
] as const;

/** Solo copia los campos editables: nunca id ni fechas enviados por el cliente. */
const pickEditable = (data: any) => {
  const out: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) {
    if (data?.[key] !== undefined) out[key] = data[key];
  }
  return out;
};

/** Negocio del usuario autenticado (businessId viene del middleware, nunca del cliente). */
export const getBusiness = async (businessId: string) => {
  return await prisma.business.findUnique({ where: { id: businessId } });
};

/** Actualiza el negocio del usuario. El negocio se crea en el registro, aquí solo se edita. */
export const updateBusiness = async (businessId: string, data: any) => {
  return await prisma.business.update({ where: { id: businessId }, data: pickEditable(data) });
};

export const getAttributes = async (businessId: string) => {
  return await prisma.attribute.findMany({
    where: { businessId },
  });
};

export const syncAttributes = async (businessId: string, attributesData: any[]) => {
  // Sync logic: for simplicity in V1, delete all and recreate
  // In a real app we might update existing to preserve relations if they were linked,
  // but products store dynamic attributes as JSON, so deleting Attribute definitions
  // doesn't break foreign keys on products (since there is no direct FK).
  // Wait, if we recreate them, their IDs change. The frontend uses IDs as keys in JSON.
  // It's better to update existing, create new, delete missing. Or upsert.
  // Prisma transaction:
  return await prisma.$transaction(async (tx) => {
    // Delete missing
    const incomingIds = attributesData.filter(a => a.id).map(a => a.id);
    await tx.attribute.deleteMany({
      where: {
        businessId,
        id: { notIn: incomingIds }
      }
    });

    const results = [];
    for (const attr of attributesData) {
      // Solo se actualiza si la característica pertenece a ESTE negocio;
      // un id ajeno se trata como una característica nueva.
      const owned = attr.id
        ? await tx.attribute.findFirst({ where: { id: attr.id, businessId } })
        : null;
      if (owned) {
        // update
        const updated = await tx.attribute.update({
          where: { id: owned.id },
          data: {
            name: attr.name,
            dataType: attr.dataType,
            isRequired: attr.isRequired,
            options: attr.options
          }
        });
        results.push(updated);
      } else {
        // create
        const created = await tx.attribute.create({
          data: {
            businessId,
            name: attr.name,
            dataType: attr.dataType,
            isRequired: attr.isRequired,
            options: attr.options
          }
        });
        results.push(created);
      }
    }
    return results;
  });
};
