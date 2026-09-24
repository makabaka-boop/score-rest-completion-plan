// 精确有理数：所有时值与位置都用约分后的 bigint 分数表示，
// 全程不经过浮点，杜绝附点/三连音累加后“恰在小节线”被误判的问题。

export type Fraction = readonly [bigint, bigint]; // [分子, 分母]，分母恒正、已约分

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x === 0n ? 1n : x;
}

function norm(n: bigint, d: bigint): Fraction {
  if (d === 0n) throw new Error("分数分母不能为 0");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (n === 0n) return [0n, 1n];
  const g = gcd(n, d);
  return [n / g, d / g];
}

export function frac(n: bigint | number, d: bigint | number = 1): Fraction {
  return norm(BigInt(n), BigInt(d));
}

export const ZERO: Fraction = [0n, 1n];

export function add(a: Fraction, b: Fraction): Fraction {
  return norm(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
}

export function sub(a: Fraction, b: Fraction): Fraction {
  return norm(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
}

export function mul(a: Fraction, b: Fraction): Fraction {
  return norm(a[0] * b[0], a[1] * b[1]);
}

export function mulInt(a: Fraction, k: bigint | number): Fraction {
  return norm(a[0] * BigInt(k), a[1]);
}

/** 向下取整 floor(a / b)（b>0），用于由起始位置反推实际小节号 */
export function floorDiv(a: Fraction, b: Fraction): bigint {
  // a/b = (a.n*b.d)/(a.d*b.n)，分母恒正
  const num = a[0] * b[1];
  const den = a[1] * b[0];
  if (den < 0n) throw new Error("floorDiv 除数必须为正");
  const q = num / den;
  // bigint 的除法向 0 截断，负数需要回退一格
  if (num < 0n && num % den !== 0n) return q - 1n;
  return q;
}

export function isInteger(a: Fraction): boolean {
  return a[1] === 1n;
}

/** 整除：a 是否为 b 的整数倍（即是否落在 b 的整数格线上） */
export function isMultiple(a: Fraction, b: Fraction): boolean {
  // a = k*b  <=>  a.n * b.d = k * (a.d * b.n)
  const lhs = a[0] * b[1];
  const rhs = a[1] * b[0];
  return rhs !== 0n && lhs % rhs === 0n;
}

export function compare(a: Fraction, b: Fraction): number {
  const lhs = a[0] * b[1];
  const rhs = b[0] * a[1];
  return lhs === rhs ? 0 : lhs < rhs ? -1 : 1;
}

export function max(a: Fraction, b: Fraction): Fraction {
  return compare(a, b) >= 0 ? a : b;
}

export function toNumber(a: Fraction): number {
  return Number(a[0]) / Number(a[1]);
}

export function toJSON(a: Fraction): { n: string; d: string } {
  return { n: a[0].toString(), d: a[1].toString() };
}

export function fromJSON(v: { n: string; d: string }): Fraction {
  return norm(BigInt(v.n), BigInt(v.d));
}

export function fracText(a: Fraction): string {
  return a[1] === 1n ? a[0].toString() : `${a[0]}/${a[1]}`;
}
