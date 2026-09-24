import { describe, expect, it } from "vitest";
import { ZERO, add, frac } from "./fraction";
import {
  DURATION_DENOMINATORS,
  InputEvent,
  InputVoice,
  TimeSignatureInput,
  eventDuration,
  resultToJSON,
  toTicks,
  verifyScore,
} from "./score";

const ts44: TimeSignatureInput = { numerator: 4, denominator: 4 };
const ts24: TimeSignatureInput = { numerator: 2, denominator: 4 };
const ts38: TimeSignatureInput = { numerator: 3, denominator: 8 };
const ts68: TimeSignatureInput = { numerator: 6, denominator: 8 };

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

describe("eventDuration 时值", () => {
  it("支持的时值分母齐全", () => {
    expect([...DURATION_DENOMINATORS]).toEqual([1, 2, 4, 8, 16, 32]);
  });

  it("附点乘 3/2", () => {
    expect(eventDuration(ev(1, 4, { dotted: true }))).toEqual(frac(3, 8));
    expect(eventDuration(ev(1, 2, { dotted: true }))).toEqual(frac(3, 4));
  });

  it("三连音乘 2/3", () => {
    expect(eventDuration(ev(1, 4, { triplet: true }))).toEqual(frac(1, 6));
    expect(eventDuration(ev(1, 8, { triplet: true }))).toEqual(frac(1, 12));
  });

  it("附点与三连音同时存在", () => {
    expect(eventDuration(ev(1, 4, { dotted: true, triplet: true }))).toEqual(frac(1, 4));
  });
});

describe("附点：恰落小节线不被误判", () => {
  it("4/4：附点二分 + 四分 = 整小节，末尾恰在线上，无错误", () => {
    const r = verifyScore(ts44, [voice("S", [ev(1, 2, { dotted: true }), ev(1, 4)])]);
    expect(r.firstError).toBeNull();
    expect(r.voices[0].events[1].actualBar).toBe(1);
    expect(r.voices[0].end.onBarLine).toBe(true);
    expect(r.endAligned).toBe(true);
  });

  it("4/4：附点节奏序列累计到 2 小节边界，标称小节号全部正确", () => {
    // 附点四分(3/8) + 附点四分(3/8) + 四分(1/4) = 1；再来一遍 = 2
    const r = verifyScore(ts44, [
      voice("S", [
        ev(1, 4, { dotted: true }),
        ev(1, 4, { dotted: true }),
        ev(1, 4),
        ev(2, 4, { dotted: true }),
        ev(2, 4, { dotted: true }),
        ev(2, 4),
      ]),
    ]);
    expect(r.firstError).toBeNull();
    expect(r.voices[0].events.map((e) => e.actualBar)).toEqual([1, 1, 1, 2, 2, 2]);
    expect(r.voices[0].end.end).toEqual([2n, 1n]);
  });

  it("附点使事件实际落在第 2 小节却标称第 1 小节时，报告为最早错误", () => {
    const r = verifyScore(ts44, [
      voice("S", [
        ev(1, 1), // 全音符占满第 1 小节
        ev(1, 4), // 实际在第 2 小节起点
      ]),
    ]);
    expect(r.firstError).not.toBeNull();
    expect(r.firstError!.kind).toBe("barMismatch");
    if (r.firstError?.kind === "barMismatch") {
      expect(r.firstError.eventId).toBe(r.voices[0].events[1].id);
      expect(r.firstError.nominalBar).toBe(1);
      expect(r.firstError.actualBar).toBe(2);
      expect(r.firstError.start).toEqual([1n, 1n]);
    }
  });
});

describe("三连音：恰落小节线不被误判", () => {
  it("4/4：12 个四分三连音填满 2 小节，无浮点漂移、无错误", () => {
    const events: InputEvent[] = [];
    for (let i = 0; i < 12; i++) {
      events.push(ev(i < 6 ? 1 : 2, 4, { triplet: true }));
    }
    const r = verifyScore(ts44, [voice("S", events)]);
    expect(r.firstError).toBeNull();
    expect(r.voices[0].events[5].end).toEqual([1n, 1n]);
    expect(r.voices[0].events[6].actualBar).toBe(2);
    expect(r.voices[0].end.end).toEqual([2n, 1n]);
  });

  it("6/8：八分三连音序列精确落在拍点与小节线", () => {
    // 八分三连音 = 1/12；9 个 = 3/4 = 一小节(6/8)
    const events: InputEvent[] = Array.from({ length: 9 }, (_, i) =>
      ev(i < 9 ? 1 : 2, 8, { triplet: true }),
    );
    const r = verifyScore(ts68, [voice("S", events)]);
    expect(r.firstError).toBeNull();
    expect(r.voices[0].end.barCount).toBe(1n);
  });

  it("三连音累计起始位置用整数刻度表示", () => {
    const r = verifyScore(ts38, [voice("S", [ev(1, 8, { triplet: true })])]);
    const e = r.voices[0].events[0];
    expect(() => toTicks(e.start)).not.toThrow();
    expect(toTicks(add(e.start, e.duration))).toBe(toTicks(e.end));
  });
});

describe("跨小节拆分（保持原 id）", () => {
  it("4/4：全音符从小节中点起，拆成 1/2+1/2 两个片段，id 相同", () => {
    const long = ev(1, 1);
    const r = verifyScore(ts44, [voice("S", [ev(1, 2), long])]);
    const segs = r.voices[0].segments.filter((s) => s.eventId === long.id);
    expect(segs).toHaveLength(2);
    expect(segs[0].bar).toBe(1);
    expect(segs[0].duration).toEqual([1n, 2n]);
    expect(segs[1].bar).toBe(2);
    expect(segs[1].duration).toEqual([1n, 2n]);
    expect(segs[0].end).toEqual([1n, 1n]);
    expect(segs[1].start).toEqual([1n, 1n]);
  });

  it("跨多个小节：附点全音符从第 1 小节末 1/4 起，拆 1/4+1+1/4", () => {
    // 附点全音符 = 3/2；起点 3/4，终点 9/4
    const long = ev(1, 1, { dotted: true });
    const r = verifyScore(ts44, [voice("S", [ev(1, 2), ev(1, 4), long])]);
    const segs = r.voices[0].segments.filter((s) => s.eventId === long.id);
    expect(segs.map((s) => s.bar)).toEqual([1, 2, 3]);
    expect(segs.map((s) => s.duration)).toEqual([
      [1n, 4n],
      [1n, 1n],
      [1n, 4n],
    ]);
    const er = r.voices[0].events.find((e) => e.id === long.id)!;
    expect(er.segmentCount).toBe(3);
  });

  it("2/4：三连音附点组合跨界时片段时长之和等于事件时长", () => {
    // 附点四分 = 3/8，小节长 1/2。连续附点四分：3/8 开始的第二个会跨界
    const a = ev(1, 4, { dotted: true });
    const b = ev(1, 4, { dotted: true });
    const r = verifyScore(ts24, [voice("S", [a, b])]);
    const segsB = r.voices[0].segments.filter((s) => s.eventId === b.id);
    expect(segsB).toHaveLength(2);
    expect(segsB[0].bar).toBe(1);
    expect(segsB[1].bar).toBe(2);
    const total = segsB.reduce((acc, s) => add(acc, s.duration), ZERO);
    expect(total).toEqual([3n, 8n]);
  });

  it("恰在线上结束的事件不产生下一小节空片段", () => {
    const e = ev(1, 1);
    const r = verifyScore(ts44, [voice("S", [e])]);
    expect(r.voices[0].segments).toHaveLength(1);
    expect(r.voices[0].segments[0]).toMatchObject({ eventId: e.id, bar: 1 });
    expect(r.voices[0].segments[0].end).toEqual([1n, 1n]);
  });
});

describe("多声部结尾对齐", () => {
  it("两声部同长且都在小节线上：对齐，无差额", () => {
    const r = verifyScore(ts44, [
      voice("A", [ev(1, 1)]),
      voice("B", [ev(1, 2), ev(1, 2)]),
    ]);
    expect(r.endAligned).toBe(true);
    expect(r.targetBars).toBe(1n);
    expect(r.voices.map((v) => v.end.deficit)).toEqual([
      [0n, 1n],
      [0n, 1n],
    ]);
  });

  it("两声部末尾错开：标出未补足声部与精确差额", () => {
    // A = 全音符(1 小节)；B = 二分(1/2)。目标 1 小节
    const r = verifyScore(ts44, [
      voice("A", [ev(1, 1)]),
      voice("B", [ev(1, 2)]),
    ]);
    expect(r.endAligned).toBe(false);
    expect(r.targetEnd).toEqual([1n, 1n]);
    expect(r.voices[0].end.deficit).toEqual([0n, 1n]);
    expect(r.voices[1].end.deficit).toEqual([1n, 2n]);
    expect(r.voices[1].end.onBarLine).toBe(false);
  });

  it("最长声部自身不在小节线上：目标取其下一条小节线，所有声部都需补足", () => {
    // A = 附点二分(3/4)；B = 二分(1/2)；4/4 目标 1 小节
    const r = verifyScore(ts44, [
      voice("A", [ev(1, 2, { dotted: true })]),
      voice("B", [ev(1, 2)]),
    ]);
    expect(r.endAligned).toBe(false);
    expect(r.targetBars).toBe(1n);
    expect(r.voices[0].end.deficit).toEqual([1n, 4n]);
    expect(r.voices[1].end.deficit).toEqual([1n, 2n]);
  });

  it("A 满 2 小节、B 满 1 小节：目标 2 小节，B 差 1 整小节", () => {
    const r = verifyScore(ts44, [
      voice("A", [ev(1, 1), ev(2, 1)]),
      voice("B", [ev(1, 1)]),
    ]);
    expect(r.targetBars).toBe(2n);
    expect(r.voices[1].end.deficit).toEqual([1n, 1n]);
    expect(r.endAligned).toBe(false);
  });

  it("四声部全部支持，短声部差额按有理数精确给出", () => {
    // A=1, B=3/4(附点二分), C=1/2, D=1/4；目标 1
    const r = verifyScore(ts44, [
      voice("A", [ev(1, 1)]),
      voice("B", [ev(1, 2, { dotted: true })]),
      voice("C", [ev(1, 2)]),
      voice("D", [ev(1, 4)]),
    ]);
    expect(r.voices).toHaveLength(4);
    expect(r.voices.map((v) => v.end.deficit)).toEqual([
      [0n, 1n],
      [1n, 4n],
      [1n, 2n],
      [3n, 4n],
    ]);
  });
});

describe("最早错误报告", () => {
  it("多个错误时报告起始位置最早者", () => {
    const r = verifyScore(ts44, [
      voice("S", [
        ev(9, 1), // 实际第 1 小节，位置 0，错误
        ev(9, 1), // 实际第 2 小节，位置 1，错误
      ]),
    ]);
    expect(r.firstError).not.toBeNull();
    if (r.firstError?.kind === "barMismatch") {
      expect(r.firstError.eventIndex).toBe(0);
      expect(r.firstError.start).toEqual([0n, 1n]);
    }
  });

  it("不同声部同位置错误时取声部序号更小者", () => {
    const r = verifyScore(ts44, [
      voice("A", [ev(2, 1)]),
      voice("B", [ev(2, 1)]),
    ]);
    expect(r.firstError).not.toBeNull();
    expect(r.firstError!.voiceIndex).toBe(0);
  });
});

describe("JSON 导出引用同一结果", () => {
  it("分数与小节数以精确有理数序列化，可还原复算", () => {
    const r = verifyScore(ts44, [
      voice("A", [ev(1, 2, { dotted: true }), ev(1, 4)]),
    ]);
    const json = resultToJSON(r);
    const parsed = JSON.parse(json);
    expect(parsed.reportId).toBe(r.reportId);
    expect(parsed.voices[0].events[0].duration).toEqual({
      __frac__: { n: "3", d: "4" },
    });
    expect(parsed.targetBars).toEqual({ __bigint__: "1" });
    expect(parsed.firstError).toBeNull();
  });

  it("导出内容含差额与刻度说明", () => {
    const r = verifyScore(ts44, [voice("A", [ev(1, 2)])]);
    const parsed = JSON.parse(resultToJSON(r));
    expect(parsed.ticksPerWhole).toBe(192);
    expect(parsed.endAligned).toBe(false);
    expect(parsed.voices[0].end.deficit.__frac__).toEqual({ n: "1", d: "2" });
  });
});
