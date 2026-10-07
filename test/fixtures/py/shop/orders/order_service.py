import json

from shop.cart.validate import validate_cart
from shop.notify.email import send_receipt
from shop.orders.base import BaseService
from shop.payments.gateway import PaymentProvider


class OrderService(BaseService):
    """Creates and pays for customer orders."""

    def __init__(self, gateway: PaymentProvider) -> None:
        self.gateway = gateway

    def place_order(self, cart: dict) -> str:
        if not validate_cart(cart):
            raise ValueError("invalid cart")
        receipt = self._charge_payment(total(cart))
        send_receipt(receipt)
        self.audit(json.dumps(cart))
        validate_cart(cart)
        return receipt

    def cancel_order(self, order_id: str) -> None:
        self.audit(f"cancel {order_id}")

    def _charge_payment(self, amount: float) -> str:
        return self.gateway.charge(amount)


def total(cart: dict) -> float:
    return sum(item["price"] * item["quantity"] for item in cart["items"])
