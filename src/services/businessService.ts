import prisma from '../config/db';

export const getBusiness = async () => {
  return await prisma.business.findFirst();
};

export const upsertBusiness = async (data: any) => {
  const existing = await prisma.business.findFirst();
  if (existing) {
    return await prisma.business.update({
      where: { id: existing.id },
      data,
    });
  } else {
    return await prisma.business.create({
      data,
    });
  }
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
      if (attr.id) {
        // update
        const updated = await tx.attribute.update({
          where: { id: attr.id },
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
