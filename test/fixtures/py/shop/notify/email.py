def send_receipt(receipt: str) -> None:
    retry(3, lambda: print(receipt))


def retry(times: int, action) -> None:
    action()
    if times > 1:
        retry(times - 1, action)


def is_even(n: int) -> bool:
    return True if n == 0 else is_odd(n - 1)


def is_odd(n: int) -> bool:
    return False if n == 0 else is_even(n - 1)
