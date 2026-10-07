from abc import ABC, abstractmethod


class PaymentProvider(ABC):
    @abstractmethod
    def charge(self, total: float) -> str: ...


class PaymentGateway(PaymentProvider):
    def charge(self, total: float) -> str:
        self._log(f"charge {total}")
        return f"receipt-{total}"

    def refund(self, receipt_id: str) -> None:
        self._log(f"refund {receipt_id}")

    def _log(self, message: str) -> None:
        print(message)
