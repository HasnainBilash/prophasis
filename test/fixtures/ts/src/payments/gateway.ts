export interface PaymentProvider {
  charge(total: number): Promise<string>;
}

export class PaymentGateway implements PaymentProvider {
  async charge(total: number): Promise<string> {
    this.log(`charge ${total}`);
    return `receipt-${total}`;
  }

  refund(id: string): void {
    this.log(`refund ${id}`);
  }

  private log(message: string): void {
    console.log(message);
  }
}
