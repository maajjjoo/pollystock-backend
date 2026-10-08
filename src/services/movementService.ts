import prisma from '../config/db';

export const getMovements = async (businessId: string, productId?: string) => {
  const whereClause: any = {
    product: { businessId },
  };
  if (productId) {
    whereClause.productId = productId;
  }

  return await prisma.movement.findMany({
    where: whereClause,
    orderBy: { date: 'desc' },
  });
};

export const getMovementById = async (businessId: string, id: string) => {
  return await prisma.movement.findFirst({
    where: {
      id,
      product: { businessId },
    },
  });
};

export const createMovement = async (businessId: string, data: { productId: string; type: string; quantity: number; note?: string }) => {
  return await prisma.$transaction(async (tx) => {
    // 1. Read and validate the product
    const product = await tx.product.findFirst({
      where: { id: data.productId, businessId },
    });

    if (!product) {
      throw new Error('PRODUCT_NOT_FOUND');
    }

    // 2. Calculate the new stock
    const currentStock = Number(product.stockQuantity);
    let newStock = currentStock;

    if (data.type === 'ENTRY') {
      newStock = currentStock + data.quantity;
    } else if (data.type === 'EXIT') {
      newStock = currentStock - data.quantity;
      if (newStock < 0) {
        throw new Error('INSUFFICIENT_STOCK');
      }
    } else {
      throw new Error('INVALID_MOVEMENT_TYPE');
    }

    // 3. Update the product stock
    await tx.product.update({
      where: { id: product.id },
      data: { stockQuantity: newStock },
    });

    // 4. Create the movement
    const movement = await tx.movement.create({
      data: {
        productId: product.id,
        type: data.type,
        quantity: data.quantity,
        note: data.note || null,
      },
    });

    return movement;
  });
};
