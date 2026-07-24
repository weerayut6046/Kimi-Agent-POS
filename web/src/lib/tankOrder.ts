type ProductOrderItem = {
  productId: number;
};

type TankOrderItem = ProductOrderItem & {
  id: number;
};

export function sortProductsByTankOrder<T extends ProductOrderItem>(
  products: T[],
  tanks: TankOrderItem[]
) {
  const orderByProductId = new Map<number, number>();
  for (const tank of tanks) {
    if (!orderByProductId.has(tank.productId)) {
      orderByProductId.set(tank.productId, orderByProductId.size);
    }
  }

  return products
    .map((product, index) => ({ product, index }))
    .sort((a, b) => {
      const aOrder = orderByProductId.get(a.product.productId);
      const bOrder = orderByProductId.get(b.product.productId);
      if (aOrder === undefined && bOrder === undefined) {
        return a.index - b.index;
      }
      if (aOrder === undefined) return 1;
      if (bOrder === undefined) return -1;
      return aOrder - bOrder;
    })
    .map(item => item.product);
}

export function reorderTanksByProductOrder<T extends TankOrderItem>(
  tanks: T[],
  productIds: number[]
) {
  const orderByProductId = new Map<number, number>();
  for (const productId of productIds) {
    if (!orderByProductId.has(productId)) {
      orderByProductId.set(productId, orderByProductId.size);
    }
  }

  return tanks
    .map((tank, index) => ({ tank, index }))
    .sort((a, b) => {
      const aOrder = orderByProductId.get(a.tank.productId);
      const bOrder = orderByProductId.get(b.tank.productId);
      if (aOrder === undefined && bOrder === undefined) {
        return a.index - b.index;
      }
      if (aOrder === undefined) return 1;
      if (bOrder === undefined) return -1;
      if (aOrder === bOrder) return a.index - b.index;
      return aOrder - bOrder;
    })
    .map(item => item.tank);
}
