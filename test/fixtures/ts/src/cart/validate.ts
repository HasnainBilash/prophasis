export interface Cart {
  items: { price: number; quantity: number }[];
}

/** Checks that a cart can be ordered. */
export function validateCart(cart: Cart): boolean {
  return checkItems(cart.items) && cart.items.length > 0;
}

function checkItems(items: Cart['items']): boolean {
  return items.every((item) => item.quantity > 0);
}
