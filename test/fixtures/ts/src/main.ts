import { OrderService } from './orders/orderService';
import { PaymentGateway } from './payments/gateway';

export async function main(): Promise<void> {
  const service = new OrderService(new PaymentGateway());
  await service.placeOrder({ items: [{ price: 10, quantity: 2 }] });
}
