export function sendReceipt(receipt: string): void {
  retry(3, () => console.log(receipt));
}

export function retry(times: number, action: () => void): void {
  action();
  if (times > 1) {
    retry(times - 1, action);
  }
}

export function isEven(n: number): boolean {
  return n === 0 ? true : isOdd(n - 1);
}

export function isOdd(n: number): boolean {
  return n === 0 ? false : isEven(n - 1);
}
