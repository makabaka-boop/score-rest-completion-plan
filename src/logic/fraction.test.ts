import { describe, expect, it } from "vitest";
import {
  add,
  compare,
  floorDiv,
  frac,
  fracText,
  isMultiple,
  mul,
  sub,
} from "./fraction";

describe("有理数运算", () => {
  it("附点时值 1/4 × 3/2 = 3/8", () => {
    expect(mul(frac(1, 4), frac(3, 2))).toEqual([3n, 8n]);
  });

  it("三连音时值 1/4 × 2/3 = 1/6", () => {
    expect(mul(frac(1, 4), frac(2, 3))).toEqual([1n, 6n]);
  });

  it("附点三连音 1/4 × 3/2 × 2/3 约分回 1/4", () => {
    const d = mul(mul(frac(1, 4), frac(3, 2)), frac(2, 3));
    expect(d).toEqual([1n, 4n]);
  });

  it("六个四分三连音精确累加成一全音符（无浮点误差）", () => {
    const tripletQuarter = mul(frac(1, 4), frac(2, 3)); // 1/6
    let pos = frac(0);
    for (let i = 0; i < 6; i++) pos = add(pos, tripletQuarter);
    expect(pos).toEqual([1n, 1n]);
  });

  it("附点节奏 3/8 + 1/8 恰为半全音符，落在小节线上可判定", () => {
    const dottedEighth = mul(frac(1, 8), frac(3, 2)); // 3/16
    let pos = frac(0);
    pos = add(pos, dottedEighth);
    pos = add(pos, dottedEighth); // 3/8
    pos = add(pos, frac(1, 8)); // 1/2
    expect(pos).toEqual([1n, 2n]);
    expect(isMultiple(pos, frac(1, 2))).toBe(true); // 2/4 小节线
  });

  it("floorDiv 对负数向负无穷取整", () => {
    expect(floorDiv(frac(1), frac(1, 2))).toBe(2n);
    expect(floorDiv(frac(6, 6), frac(1, 4))).toBe(4n);
    expect(floorDiv(frac(-1, 6), frac(1, 4))).toBe(-1n);
  });

  it("compare/sub 正确", () => {
    expect(compare(add(frac(1, 6), frac(1, 6)), frac(1, 3))).toBe(0);
    expect(sub(frac(1), frac(1, 6))).toEqual([5n, 6n]);
    expect(fracText(frac(2, 3))).toBe("2/3");
  });
});
