import { describe, expect, it } from "vitest";
import { Fraction, add, compare, floorDiv, frac, mulInt } from "./fraction";
import {
  InputEvent,
  InputVoice,
  REST_DURATION_TABLE,
  RestItem,
  TimeSignatureInput,
  fillSegmentTicks,
  planRestCompletion,
  resultToJSON,
  splitGapByBars,
  verifyScore,
} from "./score";

const ts44: TimeSignatureInput = { numerator: 4, denominator: 4 };
const ts68: TimeSignatureInput = { numerator: 6, denominator: 8 };

let counter = 0;
function ev(
  bar: number,
  denom: InputEvent["denom"],
  opts: { dotted?: boolean; triplet?: boolean; id?: string } = {},
): InputEvent {
  counter += 1;
  return {
    id: opts.id ?? `r${counter}`,
    bar,
    denom,
    dotted: opts.dotted ?? false,
    triplet: opts.triplet ?? false,
  };
}

function voice(name: string, events: InputEvent[]): InputVoice {
  return { name, events };
}

function ticksOf(specs: { ticks: number }[] | null): number[] | null {
  return specs === null ? null : specs.map((s) => s.ticks);
}

/** 断言一枚休止符完全落在其标注小节之内（不跨小节线） */
function expectItemWithinBar(item: RestItem, barLength: Fraction) {
  const barStart = mulInt(barLength, item.bar - 1);
  const barEnd = add(barStart, barLength);
  expect(compare(item.start, barStart)).toBeGreaterThanOrEqual(0);
  expect(compare(item.end, barEnd)).toBeLessThanOrEqual(0);
  expect(compare(item.end, item.start)).toBeGreaterThan(0);
  expect(Number(floorDiv(item.start, barLength)) + 1).toBe(item.bar);
}

describe("休止符时值表", () => {
  it("覆盖分母 × 附点 × 三连音，同一刻度只保留最简写法，按从长到短排列", () => {
    const ticksList = REST_DURATION_TABLE.map((d) => d.ticks);
    expect(new Set(ticksList).size).toBe(ticksList.length);
    expect(ticksList).toHaveLength(18);
    for (let i = 1; i < ticksList.length; i++) {
      expect(ticksList[i]).toBeLessThan(ticksList[i - 1]);
    }
  });

  it("附点+三连音恒等于无修饰，规范写法取无修饰", () => {
    const at = (ticks: number) => REST_DURATION_TABLE.find((d) => d.ticks === ticks)!;
    expect(at(192)).toMatchObject({ denom: 1, dotted: false, triplet: false });
    expect(at(96)).toMatchObject({ denom: 2, dotted: false, triplet: false });
    expect(at(48)).toMatchObject({ denom: 4, dotted: false, triplet: false });
    expect(at(288)).toMatchObject({ denom: 1, dotted: true, triplet: false });
    expect(at(128)).toMatchObject({ denom: 1, dotted: false, triplet: true });
    expect(at(9)).toMatchObject({ denom: 32, dotted: true, triplet: false });
    expect(at(4)).toMatchObject({ denom: 32, dotted: false, triplet: true });
  });
});

describe("fillSegmentTicks 单段最简组合", () => {
  it("空段为 0 枚", () => {
    expect(fillSegmentTicks(0)).toEqual([]);
  });

  it("附点时值单枚组成", () => {
    expect(ticksOf(fillSegmentTicks(36))).toEqual([36]); // 附点八分
    expect(ticksOf(fillSegmentTicks(9))).toEqual([9]); // 附点三十二分
    expect(fillSegmentTicks(36)![0]).toMatchObject({ denom: 8, dotted: true, triplet: false });
  });

  it("三连音时值单枚组成", () => {
    expect(ticksOf(fillSegmentTicks(32))).toEqual([32]); // 四分三连音
    expect(ticksOf(fillSegmentTicks(4))).toEqual([4]); // 三十二分三连音
    expect(fillSegmentTicks(32)![0]).toMatchObject({ denom: 4, dotted: false, triplet: true });
  });

  it("符号数并列时从前往后时值较长者优先", () => {
    // 20 = 16+4 = 12+8（同为 2 枚）→ 首枚取更长的 16
    expect(ticksOf(fillSegmentTicks(20))).toEqual([16, 4]);
    // 28 = 24+4 = 16+12 → 首枚取 24
    expect(ticksOf(fillSegmentTicks(28))).toEqual([24, 4]);
    // 40 = 36+4 = 32+8 = 24+16 → 首枚取 36
    expect(ticksOf(fillSegmentTicks(40))).toEqual([36, 4]);
  });

  it("最少符号数优先于其他偏好", () => {
    // 576 = 288+288（2 枚附点全音符）优于 192+192+192（3 枚全音符）
    expect(ticksOf(fillSegmentTicks(576))).toEqual([288, 288]);
    expect(ticksOf(fillSegmentTicks(100))).toEqual([96, 4]);
  });

  it("无法由允许时值精确组成时返回 null", () => {
    for (const l of [1, 2, 3, 5, 7, 11]) {
      expect(fillSegmentTicks(l)).toBeNull();
    }
  });
});

// ---------- 穷举预言机 ----------

const ALLOWED_TICKS = [...new Set(REST_DURATION_TABLE.map((d) => d.ticks))].sort(
  (a, b) => b - a,
);

/**
 * 穷举预言机：枚举全部多重集（不降序列各一次），
 * 取符号数最少者；并列时取“从前到后时值较长者优先”意义下的字典序最大者。
 */
function oracleFill(L: number): number[] | null {
  let best: number[] | null = null;
  const seq: number[] = [];
  const lexGreater = (a: number[], b: number[]): boolean => {
    for (let i = 0; i < a.length && i < b.length; i++) {
      if (a[i] !== b[i]) return a[i] > b[i];
    }
    return false;
  };
  const dfs = (remaining: number, startIdx: number) => {
    if (best !== null && seq.length >= best.length) return;
    if (remaining === 0) {
      if (best === null || seq.length < best.length || lexGreater(seq, best)) {
        best = [...seq];
      }
      return;
    }
    for (let i = startIdx; i < ALLOWED_TICKS.length; i++) {
      const d = ALLOWED_TICKS[i];
      if (d > remaining) continue;
      seq.push(d);
      dfs(remaining - d, i);
      seq.pop();
    }
  };
  dfs(L, 0);
  return best;
}

describe("穷举预言机核对（小缺口 0–72 刻度）", () => {
  it("最少符号数与平局取舍均与穷举一致（含不可组成段）", () => {
    for (let l = 0; l <= 72; l++) {
      expect(ticksOf(fillSegmentTicks(l)), `段长 ${l} 刻度`).toEqual(oracleFill(l));
    }
  });
});

describe("splitGapByBars 按小节边界拆分缺口", () => {
  it("跨小节缺口拆成逐小节段，段长为整数刻度", () => {
    const segs = splitGapByBars(frac(3, 4), frac(2), frac(1));
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ bar: 1, ticks: 48 });
    expect(segs[0].start).toEqual([3n, 4n]);
    expect(segs[0].end).toEqual([1n, 1n]);
    expect(segs[1]).toMatchObject({ bar: 2, ticks: 192 });
    expect(segs[1].start).toEqual([1n, 1n]);
  });

  it("起点恰在小节线上时归属下一小节", () => {
    const segs = splitGapByBars(frac(1), frac(5, 2), frac(1));
    expect(segs.map((s) => s.bar)).toEqual([2, 3]);
    expect(segs[1].end).toEqual([5n, 2n]);
  });

  it("非整小节（6/8 小节长 3/4）从中途拆到下一条小节线之后", () => {
    const segs = splitGapByBars(frac(1, 2), frac(3, 2), frac(3, 4));
    expect(segs.map((s) => s.bar)).toEqual([1, 2]);
    expect(segs[0].start).toEqual([1n, 2n]);
    expect(segs[0].end).toEqual([3n, 4n]);
    expect(segs[0].ticks).toBe(48);
    expect(segs[1].ticks).toBe(144);
  });

  it("空缺口无段", () => {
    expect(splitGapByBars(frac(1), frac(1), frac(1))).toEqual([]);
  });
});

describe("planRestCompletion 补齐规划", () => {
  it("附点：缺口 3/16 由一枚附点八分休止符补齐", () => {
    const r = verifyScore(ts44, [
      voice("A", [ev(1, 1)]),
      voice("B", [ev(1, 2), ev(1, 4), ev(1, 16)]), // 结束于 13/16
    ]);
    expect(r.restPlan.ok).toBe(true);
    expect(r.restPlan.items).toHaveLength(1);
    const it0 = r.restPlan.items[0];
    expect(it0).toMatchObject({
      voiceIndex: 1,
      voiceName: "B",
      bar: 1,
      denom: 8,
      dotted: true,
      triplet: false,
    });
    expect(it0.start).toEqual([13n, 16n]);
    expect(it0.end).toEqual([1n, 1n]);
    expect(it0.duration).toEqual([3n, 16n]);
  });

  it("三连音：缺口 1/6 由一枚四分三连音休止符补齐", () => {
    const r = verifyScore(ts44, [
      voice("A", [ev(1, 1)]),
      voice("B", [ev(1, 2), ev(1, 4, { triplet: true }), ev(1, 4, { triplet: true })]), // 5/6
    ]);
    expect(r.restPlan.ok).toBe(true);
    expect(r.restPlan.items).toHaveLength(1);
    expect(r.restPlan.items[0]).toMatchObject({ denom: 4, dotted: false, triplet: true });
    expect(r.restPlan.items[0].start).toEqual([5n, 6n]);
    expect(r.restPlan.items[0].end).toEqual([1n, 1n]);
  });

  it("非整小节：缺口跨小节线时逐段补齐，任何一枚都不跨线", () => {
    const r = verifyScore(ts44, [
      voice("A", [ev(1, 1), ev(2, 1)]),
      voice("B", [ev(1, 2, { dotted: true })]), // 结束于 3/4
    ]);
    expect(r.restPlan.ok).toBe(true);
    const items = r.restPlan.items;
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.bar)).toEqual([1, 2]);
    expect(items[0]).toMatchObject({ denom: 4, dotted: false, triplet: false });
    expect(items[1]).toMatchObject({ denom: 1, dotted: false, triplet: false });
    expect(items[0].end).toEqual(items[1].start); // 两枚首尾相接
    for (const it of items) expectItemWithinBar(it, r.barLength);
    // 清单总时长恒等于该声部的精确差额
    const total = items.reduce((acc, i) => add(acc, i.duration), frac(0));
    expect(total).toEqual(r.voices[1].end.deficit);
  });

  it("6/8：短声部从小节中途补两段（非整小节 + 附点）", () => {
    const r = verifyScore(ts68, [
      voice("A", [ev(1, 1, { dotted: true })]), // 3/2 = 2 个 6/8 小节（小节长 3/4）
      voice("B", [ev(1, 4)]), // 1/4
    ]);
    expect(r.restPlan.ok).toBe(true);
    const items = r.restPlan.items;
    expect(items.map((i) => i.bar)).toEqual([1, 2]);
    expect(items[0]).toMatchObject({ denom: 2, dotted: false }); // 1/2 补满小节 1
    expect(items[1]).toMatchObject({ denom: 2, dotted: true }); // 3/4 填满小节 2
    for (const it of items) expectItemWithinBar(it, r.barLength);
  });

  it("不可补齐段：说明具体声部及缺口，不生成貌似对齐的部分清单", () => {
    const r = verifyScore(ts44, [
      voice("A", [ev(1, 1)]),
      voice("B", [
        ev(1, 1, { triplet: true }), // 128 刻度
        ev(1, 4), // 48
        ev(1, 32, { dotted: true }), // 9
        ev(1, 32), // 6 → 共 191/192，缺口 1/192 不可组成
      ]),
      voice("C", [ev(1, 2)]), // 缺口 1/2 本来可补
    ]);
    expect(r.restPlan.ok).toBe(false);
    expect(r.restPlan.failures).toHaveLength(1);
    const f = r.restPlan.failures[0];
    expect(f).toMatchObject({ voiceIndex: 1, voiceName: "B", bar: 1, ticks: 1 });
    expect(f.start).toEqual([191n, 192n]);
    expect(f.end).toEqual([1n, 1n]);
    // C 的缺口虽然可补，也不生成任何部分清单
    expect(r.restPlan.items).toEqual([]);
  });

  it("全部声部对齐时无需补齐", () => {
    const r = verifyScore(ts44, [
      voice("A", [ev(1, 1)]),
      voice("B", [ev(1, 2), ev(1, 2)]),
    ]);
    expect(r.restPlan.ok).toBe(true);
    expect(r.restPlan.items).toEqual([]);
    expect(r.restPlan.failures).toEqual([]);
  });

  it("核对结果内嵌的规划与独立重算一致（清单/时间轴/下载同源）", () => {
    const r = verifyScore(ts44, [
      voice("A", [ev(1, 1), ev(2, 1)]),
      voice("B", [ev(1, 2, { dotted: true })]),
    ]);
    expect(r.restPlan).toEqual(planRestCompletion(r));
  });

  it("下载 JSON 含同一规划结果（分数按 __frac__ 序列化）", () => {
    const r = verifyScore(ts44, [
      voice("A", [ev(1, 1)]),
      voice("B", [ev(1, 2), ev(1, 4), ev(1, 16)]),
    ]);
    const parsed = JSON.parse(resultToJSON(r));
    expect(parsed.restPlan.ok).toBe(true);
    expect(parsed.restPlan.items).toHaveLength(1);
    expect(parsed.restPlan.items[0].start).toEqual({ __frac__: { n: "13", d: "16" } });
    expect(parsed.restPlan.items[0].duration).toEqual({ __frac__: { n: "3", d: "16" } });
    expect(parsed.restPlan.items[0].denom).toBe(8);
    expect(parsed.restPlan.items[0].dotted).toBe(true);
    expect(parsed.restPlan.items[0].triplet).toBe(false);
  });

  it("不可补齐时 JSON 记录具体缺口而非部分清单", () => {
    const r = verifyScore(ts44, [
      voice("A", [ev(1, 1)]),
      voice("B", [
        ev(1, 1, { triplet: true }),
        ev(1, 4),
        ev(1, 32, { dotted: true }),
        ev(1, 32),
      ]),
    ]);
    const parsed = JSON.parse(resultToJSON(r));
    expect(parsed.restPlan.ok).toBe(false);
    expect(parsed.restPlan.items).toEqual([]);
    expect(parsed.restPlan.failures[0].start).toEqual({ __frac__: { n: "191", d: "192" } });
    expect(parsed.restPlan.failures[0].ticks).toBe(1);
  });
});
