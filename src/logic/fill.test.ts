import { describe, expect, it } from "vitest";
import { ZERO, add, compare, frac, floorDiv, mulInt } from "./fraction";
import {
  InputEvent,
  InputVoice,
  RestFill,
  TimeSignatureInput,
  allowedRestSpecs,
  eventDuration,
  planSegmentRests,
  planVoiceFill,
  resultToJSON,
  toTicks,
  verifyScore,
} from "./score";

const ts44: TimeSignatureInput = { numerator: 4, denominator: 4 };
const ts38: TimeSignatureInput = { numerator: 3, denominator: 8 };
const ts28: TimeSignatureInput = { numerator: 2, denominator: 8 };

let counter = 0;
function ev(
  bar: number,
  denom: InputEvent["denom"],
  opts: { dotted?: boolean; triplet?: boolean; id?: string } = {},
): InputEvent {
  counter += 1;
  return {
    id: opts.id ?? `e${counter}`,
    bar,
    denom,
    dotted: opts.dotted ?? false,
    triplet: opts.triplet ?? false,
  };
}

function voice(name: string, events: InputEvent[]): InputVoice {
  return { name, events };
}

/** 每枚休止符都落在申报的小节内、不跨小节线 */
function assertNoRestCrossesBarLine(rests: RestFill[], barLength: readonly [bigint, bigint]) {
  for (const r of rests) {
    expect(Number(floorDiv(r.start, barLength)) + 1).toBe(r.bar);
    expect(compare(r.start, mulInt(barLength, r.bar - 1)) >= 0).toBe(true);
    expect(compare(r.end, mulInt(barLength, r.bar)) <= 0).toBe(true);
  }
}

// ---------- 穷举预言机（独立实现：直接枚举所有有序组合） ----------

/** 与 score.ts 分开重推允许刻度：192/denom ×（附点 3/2）×（三连音 2/3） */
function oracleTickSet(): number[] {
  const set = new Set<number>();
  for (const denom of [1, 2, 4, 8, 16, 32]) {
    for (const dotted of [false, true]) {
      for (const triplet of [false, true]) {
        const n = 192n * (dotted ? 3n : 1n) * (triplet ? 2n : 1n);
        const d = BigInt(denom) * (dotted ? 2n : 1n) * (triplet ? 3n : 1n);
        if (n % d !== 0n) throw new Error("预言机刻度不是整数");
        set.add(Number(n / d));
      }
    }
  }
  return [...set].sort((a, b) => b - a);
}

const ORACLE_PARTS = oracleTickSet();
const ORACLE_MIN = ORACLE_PARTS[ORACLE_PARTS.length - 1];
const ORACLE_MAX = ORACLE_PARTS[0];

/** 枚举总和为 gap、长度恰为 len 的全部有序序列（带可行性剪枝） */
function enumerateExact(gap: number, len: number): number[][] {
  const out: number[][] = [];
  const stack: number[] = [];
  function dfs(rem: number) {
    const left = len - stack.length;
    if (left === 0) {
      if (rem === 0) out.push([...stack]);
      return;
    }
    for (const p of ORACLE_PARTS) {
      if (p > rem) continue;
      const rem2 = rem - p;
      const left2 = left - 1;
      if (rem2 < left2 * ORACLE_MIN || rem2 > left2 * ORACLE_MAX) continue;
      stack.push(p);
      dfs(rem2);
      stack.pop();
    }
  }
  dfs(gap);
  return out;
}

/** 平局判定：从前到后时值较长者优先，即逐位比较取刻度较大者 */
function lexBetter(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return a.length < b.length;
}

/** 预言机：最少符号数 + 并列时的唯一最优序列；不可补齐返回 null */
function oracleBest(gap: number): number[] | null {
  if (gap === 0) return [];
  const maxLen = Math.floor(gap / ORACLE_MIN);
  for (let len = 1; len <= maxLen; len++) {
    const seqs = enumerateExact(gap, len);
    if (seqs.length > 0) {
      return seqs.reduce((best, cur) => (lexBetter(cur, best) ? cur : best));
    }
  }
  return null;
}

describe("allowedRestSpecs 允许时值", () => {
  it("去重后 18 种刻度，按从长到短排列", () => {
    const specs = allowedRestSpecs();
    expect(specs).toHaveLength(18);
    const ticks = specs.map((s) => s.ticks);
    expect([...ticks].sort((a, b) => b - a)).toEqual(ticks);
    expect(new Set(ticks).size).toBe(18);
  });

  it("每种的属性与原事件时值公式一致", () => {
    for (const s of allowedRestSpecs()) {
      expect(toTicks(eventDuration(s))).toBe(s.ticks);
    }
  });

  it("同刻度取最简单写法（附点+三连音的等价写法不出现）", () => {
    const byTicks = new Map(allowedRestSpecs().map((s) => [s.ticks, s]));
    expect(byTicks.get(192)).toMatchObject({ denom: 1, dotted: false, triplet: false });
    expect(byTicks.get(96)).toMatchObject({ denom: 2, dotted: false, triplet: false });
    expect(byTicks.get(4)).toMatchObject({ denom: 32, dotted: false, triplet: true });
    expect(byTicks.get(9)).toMatchObject({ denom: 32, dotted: true, triplet: false });
  });
});

describe("planSegmentRests 单段最少符号", () => {
  it("空缺口返回空清单，负缺口报错", () => {
    expect(planSegmentRests(0)).toEqual([]);
    expect(() => planSegmentRests(-1)).toThrow();
  });

  it("单枚符号即可补齐的常见缺口（含附点与三连音）", () => {
    expect(planSegmentRests(4)![0]).toMatchObject({ denom: 32, triplet: true });
    expect(planSegmentRests(9)![0]).toMatchObject({ denom: 32, dotted: true });
    expect(planSegmentRests(16)![0]).toMatchObject({ denom: 8, triplet: true });
    expect(planSegmentRests(24)![0]).toMatchObject({ denom: 8 });
    expect(planSegmentRests(36)![0]).toMatchObject({ denom: 8, dotted: true });
    expect(planSegmentRests(48)![0]).toMatchObject({ denom: 4 });
    expect(planSegmentRests(96)![0]).toMatchObject({ denom: 2 });
    expect(planSegmentRests(192)![0]).toMatchObject({ denom: 1 });
    expect(planSegmentRests(288)![0]).toMatchObject({ denom: 1, dotted: true });
  });

  it("符号数并列时从前到后时值较长者优先，清单唯一", () => {
    // 28 = 24+4 = 16+12（均 2 枚）→ 取 [24, 4]
    expect(planSegmentRests(28)!.map((s) => s.ticks)).toEqual([24, 4]);
    // 40 = 36+4 = 32+8 = 24+16 → 取 [36, 4]
    expect(planSegmentRests(40)!.map((s) => s.ticks)).toEqual([36, 4]);
    // 60 = 48+12 = 36+24 → 取 [48, 12]
    expect(planSegmentRests(60)!.map((s) => s.ticks)).toEqual([48, 12]);
    // 33 = 24+9 = 18+15✗ …… → 取 [24, 9]
    expect(planSegmentRests(33)!.map((s) => s.ticks)).toEqual([24, 9]);
  });

  it("小缺口穷举预言机：1..64 刻度的最少符号数与平局序列全部一致", () => {
    for (let gap = 1; gap <= 64; gap++) {
      const best = oracleBest(gap);
      const plan = planSegmentRests(gap);
      if (best === null) {
        expect(plan).toBeNull();
      } else {
        expect(plan).not.toBeNull();
        expect(plan!.map((s) => s.ticks)).toEqual(best);
      }
    }
  });

  it("1..64 中仅 1/2/3/5/7/11 刻度不可精确补齐", () => {
    const unfillable: number[] = [];
    for (let gap = 1; gap <= 64; gap++) {
      if (planSegmentRests(gap) === null) unfillable.push(gap);
    }
    expect(unfillable).toEqual([1, 2, 3, 5, 7, 11]);
  });
});

describe("planVoiceFill 按小节边界拆分缺口", () => {
  it("缺口为 1/192（1 刻度）时不可补齐，不生成部分清单", () => {
    const p = planVoiceFill(0, "X", ZERO, frac(1, 192), frac(1, 4));
    expect(p.fillable).toBe(false);
    expect(p.rests).toEqual([]);
    expect(p.failure).toMatchObject({ bar: 1 });
    expect(p.failure!.duration).toEqual([1n, 192n]);
  });

  it("跨小节缺口逐段规划，休止符首尾相接且不跨线", () => {
    // 4/4：从 3/4 补到 2 → 小节 1 补 1/4，小节 2 补 1
    const p = planVoiceFill(0, "X", frac(3, 4), frac(2), frac(1));
    expect(p.fillable).toBe(true);
    expect(p.rests.map((r) => r.bar)).toEqual([1, 2]);
    expect(p.rests[0].duration).toEqual([1n, 4n]);
    expect(p.rests[1].duration).toEqual([1n, 1n]);
    const total = p.rests.reduce((acc, r) => add(acc, r.duration), ZERO);
    expect(total).toEqual(p.deficit);
    for (let i = 1; i < p.rests.length; i++) {
      expect(p.rests[i].start).toEqual(p.rests[i - 1].end);
    }
    assertNoRestCrossesBarLine(p.rests, frac(1));
  });
});

describe("verifyScore 补齐清单（与核对结果同源）", () => {
  it("短半小节的声部：小节 1 内 1 枚二分休止符", () => {
    const r = verifyScore(ts44, [voice("A", [ev(1, 1)]), voice("B", [ev(1, 2)])]);
    const plan = r.fillPlan.voices[1];
    expect(plan.fillable).toBe(true);
    expect(plan.rests).toHaveLength(1);
    expect(plan.rests[0]).toMatchObject({
      voiceName: "B",
      bar: 1,
      denom: 2,
      dotted: false,
      triplet: false,
    });
    expect(plan.rests[0].start).toEqual([1n, 2n]);
    expect(plan.rests[0].end).toEqual([1n, 1n]);
    expect(r.fillPlan.allFillable).toBe(true);
    expect(r.fillPlan.targetEnd).toEqual(r.targetEnd);
  });

  it("跨小节缺口：附点二分声部补四分（小节 1）+ 全音符（小节 2）", () => {
    const r = verifyScore(ts44, [
      voice("A", [ev(1, 1), ev(2, 1)]),
      voice("B", [ev(1, 2, { dotted: true })]),
    ]);
    const plan = r.fillPlan.voices[1];
    expect(plan.rests.map((x) => x.bar)).toEqual([1, 2]);
    expect(plan.rests[0]).toMatchObject({ denom: 4, dotted: false, triplet: false });
    expect(plan.rests[0].start).toEqual([3n, 4n]);
    expect(plan.rests[0].end).toEqual([1n, 1n]);
    expect(plan.rests[1]).toMatchObject({ denom: 1 });
    expect(plan.rests[1].start).toEqual([1n, 1n]);
    expect(plan.rests[1].end).toEqual([2n, 1n]);
    const total = plan.rests.reduce((acc, x) => add(acc, x.duration), ZERO);
    expect(total).toEqual(plan.deficit);
    assertNoRestCrossesBarLine(plan.rests, r.barLength);
  });

  it("附点缺口：单枚附点四分休止符", () => {
    const r = verifyScore(ts44, [
      voice("A", [ev(1, 1)]),
      voice("B", [ev(1, 2), ev(1, 8)]),
    ]);
    const plan = r.fillPlan.voices[1];
    expect(plan.rests).toHaveLength(1);
    expect(plan.rests[0]).toMatchObject({ denom: 4, dotted: true, triplet: false });
    expect(plan.rests[0].duration).toEqual([3n, 8n]);
  });

  it("三连音缺口：单枚二分三连音休止符", () => {
    const r = verifyScore(ts44, [
      voice("A", [ev(1, 1)]),
      voice("B", [0, 1, 2, 3].map(() => ev(1, 4, { triplet: true }))),
    ]);
    const plan = r.fillPlan.voices[1];
    expect(plan.rests).toHaveLength(1);
    expect(plan.rests[0]).toMatchObject({ denom: 2, dotted: false, triplet: true });
    expect(plan.rests[0].duration).toEqual([1n, 3n]);
  });

  it("非整小节（3/8）：缺口按 3/8 小节边界拆成两段", () => {
    // A 附点二分 = 3/4 = 2 小节；B 四分 = 1/4 → 小节 1 补八分，小节 2 补附点四分
    const r = verifyScore(ts38, [
      voice("A", [ev(1, 2, { dotted: true })]),
      voice("B", [ev(1, 4)]),
    ]);
    const plan = r.fillPlan.voices[1];
    expect(plan.rests.map((x) => x.bar)).toEqual([1, 2]);
    expect(plan.rests[0]).toMatchObject({ denom: 8 });
    expect(plan.rests[0].duration).toEqual([1n, 8n]);
    expect(plan.rests[1]).toMatchObject({ denom: 4, dotted: true });
    expect(plan.rests[1].duration).toEqual([3n, 8n]);
    assertNoRestCrossesBarLine(plan.rests, r.barLength);
  });

  it("不可补齐段：说明声部与缺口，不生成貌似对齐的部分清单", () => {
    // 2/8 小节 = 48 刻度；声部结束于 24+9+4 = 37 刻度，缺口 11 刻度无法精确组成
    const r = verifyScore(ts28, [
      voice("A", [ev(1, 8), ev(1, 32, { dotted: true }), ev(1, 32, { triplet: true })]),
    ]);
    expect(r.firstError).toBeNull();
    const plan = r.fillPlan.voices[0];
    expect(plan.fillable).toBe(false);
    expect(plan.rests).toEqual([]);
    expect(plan.failure).not.toBeNull();
    expect(plan.failure!.bar).toBe(1);
    expect(plan.failure!.start).toEqual([37n, 192n]);
    expect(plan.failure!.end).toEqual([1n, 4n]);
    expect(plan.failure!.duration).toEqual([11n, 192n]);
    expect(r.fillPlan.allFillable).toBe(false);
  });

  it("全部对齐时无需补齐", () => {
    const r = verifyScore(ts44, [
      voice("A", [ev(1, 1)]),
      voice("B", [ev(1, 2), ev(1, 2)]),
    ]);
    expect(r.endAligned).toBe(true);
    expect(r.fillPlan.allFillable).toBe(true);
    expect(r.fillPlan.voices.every((p) => p.rests.length === 0)).toBe(true);
  });

  it("下载 JSON 与界面使用同一份规划结果", () => {
    const r = verifyScore(ts44, [voice("A", [ev(1, 1)]), voice("B", [ev(1, 2)])]);
    const parsed = JSON.parse(resultToJSON(r));
    expect(parsed.fillPlan.allFillable).toBe(true);
    expect(parsed.fillPlan.targetEnd).toEqual({ __frac__: { n: "1", d: "1" } });
    expect(parsed.fillPlan.targetBars).toEqual({ __bigint__: "1" });
    const rest = parsed.fillPlan.voices[1].rests[0];
    expect(rest.denom).toBe(2);
    expect(rest.dotted).toBe(false);
    expect(rest.triplet).toBe(false);
    expect(rest.bar).toBe(1);
    expect(rest.start).toEqual({ __frac__: { n: "1", d: "2" } });
    expect(rest.end).toEqual({ __frac__: { n: "1", d: "1" } });
  });
});
