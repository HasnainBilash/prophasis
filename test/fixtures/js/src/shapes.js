export class Shape {
  area() {
    return 0;
  }

  describe() {
    return `${this.constructor.name} with area ${format(this.area())}`;
  }
}

export class Circle extends Shape {
  constructor(radius) {
    super();
    this.radius = radius;
  }

  area() {
    return Math.PI * square(this.radius);
  }
}

/** Squares a number. */
export function square(n) {
  return n * n;
}

export const format = (value) => value.toFixed(2);
