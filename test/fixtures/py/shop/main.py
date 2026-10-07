from shop.orders.order_service import OrderService
from shop.payments.gateway import PaymentGateway


def main() -> None:
    service = OrderService(PaymentGateway())
    service.place_order({"items": [{"price": 10, "quantity": 2}]})
