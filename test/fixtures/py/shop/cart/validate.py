def validate_cart(cart: dict) -> bool:
    """Checks that a cart can be ordered."""
    return check_items(cart["items"]) and len(cart["items"]) > 0


def check_items(items: list) -> bool:
    return all(item["quantity"] > 0 for item in items)
