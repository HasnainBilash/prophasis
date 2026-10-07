import { validateCart, type Cart } from '../cart/validate';
import type { PaymentProvider } from '../payments/gateway';
import { sendReceipt } from '../notify/email';
import { BaseService } from './base';

/** Creates and pays for customer orders. */
export class OrderService extends BaseService {
  constructor(private readonly gateway: PaymentProvider) {
    super();
  }

  async placeOrder(cart: Cart): Promise<string> {
    if (!validateCart(cart)) {
      throw new Error('invalid cart');
    }
    const receipt = await this.chargePayment(total(cart));
    sendReceipt(receipt);
    this.audit(JSON.stringify(cart));
    validateCart(cart);
    return receipt;
  }

  cancelOrder(id: string): void {
    this.audit(`cancel ${id}`);
  }

  private chargePayment(amount: number): Promise<string> {
    return this.gateway.charge(amount);
  }
}

function total(cart: Cart): number {
  return cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
