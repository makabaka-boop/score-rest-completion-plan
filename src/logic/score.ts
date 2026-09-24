import {
  Fraction,
  ZERO,
  add,
  compare,
  frac,
  floorDiv,
  isMultiple,
  mul,
  mulInt,
  sub,
  toJSON,
} from "./fraction";

// ---------- 输入模型 ----------

export const DURATION_DENOMINATORS = [1, 2, 4, 8, 16, 32] as const;
export type DurationDenominator = (typeof DURATION_DENOMINATORS)[number];

export interface InputEvent {
  id: string;
  /** 标称小节号（1 起） */
  bar: number;
  /** 时值分母：全音符为 1，二分音符为 2 …… 三十二分音符为 32 */
  denom: DurationDenominator;
  dotted: boolean;
  triplet: boolean;
}

export interface InputVoice {
  name: string;
  events: InputEvent[];
}

export interface TimeSignatureInput {
  /** 每小节拍数 2..12 */
  numerator: number;
  /** 以几分音符为一拍：4 或 8 */
  denominator: 4 | 8;
}

// ---------- 结果模型 ----------

/** 一个跨小节事件被拆成的显示片段，保留原事件 id */
export interface DisplaySegment {
  eventId: string;
  eventIndex: number;
  bar: number; // 片段所在实际小节（1 起）
  start: Fraction; // 片段起点（自乐曲开头，全音符分数）
  end: Fraction; // 片段终点
  duration: Fraction; // 片段时长
  partIndex: number;
}

export interface EventResult {
  eventIndex: number;
  id: string;
  nominalBar: number;
  denom: DurationDenominator;
  dotted: boolean;
  triplet: boolean;
  start: Fraction;
  end: Fraction;
  duration: Fraction;
  actualBar: number; // 起始位置所在实际小节（1 起）
  barOk: boolean;
  segmentCount: number;
}

export interface VoiceEnd {
  name: string;
  end: Fraction; // 声部累计结束位置
  barCount: bigint; // 完整小节数（floor(end / barLength)）
  onBarLine: boolean; // 是否结束在完整小节线上
  deficit: Fraction; // 距共同目标终点（maxEnd 之后的下一条小节线）的精确差额
}

// ---------- 休止符补齐规划 ----------

/** 一枚补齐休止符：落在单个小节内，不跨小节线 */
export interface RestFill {
  voiceIndex: number;
  voiceName: string;
  bar: number; // 所在实际小节（1 起）
  start: Fraction; // 起点（自乐曲开头，全音符分数）
  end: Fraction; // 终点
  duration: Fraction; // 时值
  denom: DurationDenominator;
  dotted: boolean;
  triplet: boolean;
}

/** 无法由允许时值精确组成的缺口段 */
export interface FillFailure {
  bar: number; // 段所在实际小节（1 起）
  start: Fraction;
  end: Fraction;
  duration: Fraction; // 段长
}

export interface VoiceFillPlan {
  voiceIndex: number;
  voiceName: string;
  deficit: Fraction; // 到共同目标小节线的精确差额
  fillable: boolean; // 缺口能否由允许时值精确组成
  rests: RestFill[]; // fillable 时的完整清单；不可补齐时恒为空（不给貌似对齐的部分清单）
  failure: FillFailure | null; // 第一段无法精确组成的缺口
}

export interface FillPlan {
  targetEnd: Fraction;
  targetBars: bigint;
  allFillable: boolean; // 所有有缺口的声部都能精确补齐
  voices: VoiceFillPlan[];
}

/** 允许用于补齐的时值属性（与原事件相同：分母 × 附点 × 三连音） */
export interface DurationSpec {
  denom: DurationDenominator;
  dotted: boolean;
  triplet: boolean;
  ticks: number; // 时值对应的 1/192 全音符刻度数
}

export interface BarMismatchError {
  kind: "barMismatch";
  voiceIndex: number;
  voiceName: string;
  eventIndex: number;
  eventId: string;
  nominalBar: number;
  actualBar: number;
  start: Fraction;
}

export interface DuplicateIdError {
  kind: "duplicateId";
  voiceIndex: number;
  voiceName: string;
  eventId: string;
}

export type ScoreError = BarMismatchError | DuplicateIdError;

export interface VerifyResult {
  reportId: string;
  generatedAt: string;
  timeSignature: TimeSignatureInput;
  barLength: Fraction; // 一小节长度（全音符分数）
  ticksPerWhole: number; // 最小公共刻度：全音符 1/192
  voices: {
    name: string;
    events: EventResult[];
    segments: DisplaySegment[];
    end: VoiceEnd;
  }[];
  firstError: ScoreError | null;
  endAligned: boolean;
  targetEnd: Fraction; // 共同目标终点
  targetBars: bigint; // 共同目标完整小节数
  fillPlan: FillPlan; // 休止符补齐规划（与结论、时间轴、JSON 导出共用同一份结果）
}

// 所有可能时值与拍号长度的最小公共分母：
// 32 分三连音 = 1/48 全音符；附点 32 分 = 3/64；
// 12/8 小节 = 3/4。lcm(1..32 附带的 48, 64, 4) = 192。
export const TICKS_PER_WHOLE = 192;

/**
 * 单个事件的时值（全音符分数）。
 * 基本时值 1/denom；附点乘 3/2；三连音乘 2/3。
 */
export function eventDuration(e: Pick<InputEvent, "denom" | "dotted" | "triplet">): Fraction {
  let d = frac(1, e.denom);
  if (e.dotted) d = mul(d, frac(3, 2)); // 附点：时值乘 3/2
  if (e.triplet) d = mul(d, frac(2, 3)); // 三连音：时值乘 2/3
  return d;
}

/** 位置换算为 1/192 全音符的整数刻度 */
export function toTicks(a: Fraction): number {
  const t = mul(a, frac(TICKS_PER_WHOLE));
  if (t[1] !== 1n) {
    throw new Error(`位置 ${t[0]}/${t[1]} 不是 1/${TICKS_PER_WHOLE} 全音符的整数倍`);
  }
  return Number(t[0]);
}

export function validateInput(
  ts: TimeSignatureInput,
  voices: InputVoice[],
): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(ts.numerator) || ts.numerator < 2 || ts.numerator > 12) {
    problems.push("拍号分子必须为 2 至 12 的整数");
  }
  if (ts.denominator !== 4 && ts.denominator !== 8) {
    problems.push("拍号分母必须为 4 或 8");
  }
  if (!Array.isArray(voices) || voices.length < 1 || voices.length > 4) {
    problems.push("声部数量必须为 1 至 4");
  } else {
    voices.forEach((v, vi) => {
      if (!v.events || v.events.length < 1 || v.events.length > 120) {
        problems.push(`声部「${v.name || vi + 1}」事件数量必须为 1 至 120`);
      } else {
        v.events.forEach((e, ei) => {
          if (!e.id.trim()) problems.push(`声部 ${vi + 1} 第 ${ei + 1} 个事件缺少 id`);
          if (!DURATION_DENOMINATORS.includes(e.denom)) {
            problems.push(`事件 ${e.id || ei + 1} 的时值分母非法`);
          }
          if (!Number.isInteger(e.bar) || e.bar < 1) {
            problems.push(`事件 ${e.id || ei + 1} 的标称小节号必须为不小于 1 的整数`);
          }
        });
        const seen = new Set<string>();
        for (const e of v.events) {
          if (seen.has(e.id)) {
            problems.push(`声部「${v.name || vi + 1}」内事件 id 重复：${e.id}`);
          }
          seen.add(e.id);
        }
      }
    });
  }
  return problems;
}

function barLengthOf(ts: TimeSignatureInput): Fraction {
  // 4 分音符 = 1/4 全音符；8 分音符 = 1/8
  return frac(ts.numerator * (ts.denominator === 4 ? 2 : 1), ts.denominator === 4 ? 8 : 8);
}

function splitSegments(
  partIndex: number,
  ev: InputEvent,
  eventIndex: number,
  start: Fraction,
  end: Fraction,
  barLength: Fraction,
): DisplaySegment[] {
  const segments: DisplaySegment[] = [];
  let cursor = start;
  let guard = 0;
  while (compare(cursor, end) < 0) {
    const bar = Number(floorDiv(cursor, barLength)) + 1;
    const barStart = mulInt(barLength, bar - 1);
    const barEnd = add(barStart, barLength);
    const segEnd = compare(barEnd, end) <= 0 ? barEnd : end;
    segments.push({
      eventId: ev.id,
      eventIndex,
      bar,
      start: cursor,
      end: segEnd,
      duration: sub(segEnd, cursor),
      partIndex,
    });
    cursor = segEnd;
    if (++guard > 100000) throw new Error("片段拆分异常：循环未收敛");
  }
  return segments;
}

/**
 * 允许用于补齐的时值清单：分母 1/2/4/8/16/32 × 附点 × 三连音（与原事件相同）。
 * 同一刻度只保留写法最简单的一种（无附点、无三连音优先），按刻度从长到短排列，
 * 保证后续并列时取出的符号唯一。
 */
export function allowedRestSpecs(): DurationSpec[] {
  const byTicks = new Map<number, DurationSpec & { complexity: number }>();
  for (const denom of DURATION_DENOMINATORS) {
    for (const dotted of [false, true]) {
      for (const triplet of [false, true]) {
        const ticks = toTicks(eventDuration({ denom, dotted, triplet }));
        const complexity = (dotted ? 1 : 0) + (triplet ? 1 : 0);
        const prev = byTicks.get(ticks);
        if (!prev || complexity < prev.complexity) {
          byTicks.set(ticks, { denom, dotted, triplet, ticks, complexity });
        }
      }
    }
  }
  return [...byTicks.values()]
    .map(({ complexity: _complexity, ...spec }) => spec)
    .sort((a, b) => b.ticks - a.ticks);
}

/**
 * 单段缺口（已按小节边界切好、不跨小节线）的最少符号补齐。
 * 用 1/192 全音符整数刻度做 DP 求最少符号数；回溯时每一步取仍能达成
 * 最少符号数的最长时值，实现“符号数并列时从前到后时值较长者优先”，清单唯一。
 * 无法由允许时值精确组成时返回 null。
 */
export function planSegmentRests(gapTicks: number): DurationSpec[] | null {
  if (!Number.isInteger(gapTicks) || gapTicks < 0) {
    throw new Error("缺口刻度必须是非负整数");
  }
  if (gapTicks === 0) return [];
  const specs = allowedRestSpecs(); // 已按刻度从长到短排序
  const dp = new Array<number>(gapTicks + 1).fill(Infinity);
  dp[0] = 0;
  for (let t = 1; t <= gapTicks; t++) {
    for (const s of specs) {
      if (s.ticks <= t && dp[t - s.ticks] + 1 < dp[t]) dp[t] = dp[t - s.ticks] + 1;
    }
  }
  if (!Number.isFinite(dp[gapTicks])) return null;
  const out: DurationSpec[] = [];
  let rem = gapTicks;
  while (rem > 0) {
    const pick = specs.find((s) => s.ticks <= rem && dp[rem - s.ticks] === dp[rem] - 1);
    if (!pick) throw new Error("补齐回溯异常：DP 状态不一致");
    out.push(pick);
    rem -= pick.ticks;
  }
  return out;
}

/**
 * 单个声部的补齐规划：从精确结束位置补到共同目标小节线。
 * 先按小节边界把缺口拆成若干段，再对每段求最少符号组合；
 * 任一段无法精确组成时，该声部不生成部分清单，只记录缺口。
 */
export function planVoiceFill(
  voiceIndex: number,
  voiceName: string,
  voiceEnd: Fraction,
  targetEnd: Fraction,
  barLength: Fraction,
): VoiceFillPlan {
  const deficit = sub(targetEnd, voiceEnd);
  const base = { voiceIndex, voiceName, deficit };
  if (compare(deficit, ZERO) <= 0) {
    return { ...base, fillable: true, rests: [], failure: null };
  }
  const rests: RestFill[] = [];
  let cursor = voiceEnd;
  let guard = 0;
  while (compare(cursor, targetEnd) < 0) {
    const bar = Number(floorDiv(cursor, barLength)) + 1;
    // 段终点 = 本小节线（verifyScore 中 targetEnd 必在小节线上；取 min 以兼容任意目标）
    const barEnd = mulInt(barLength, bar);
    const segEnd = compare(barEnd, targetEnd) <= 0 ? barEnd : targetEnd;
    const specs = planSegmentRests(toTicks(sub(segEnd, cursor)));
    if (!specs) {
      return {
        ...base,
        fillable: false,
        rests: [],
        failure: { bar, start: cursor, end: segEnd, duration: sub(segEnd, cursor) },
      };
    }
    let pos = cursor;
    for (const s of specs) {
      const duration = eventDuration(s);
      const end = add(pos, duration);
      rests.push({
        voiceIndex,
        voiceName,
        bar,
        start: pos,
        end,
        duration,
        denom: s.denom,
        dotted: s.dotted,
        triplet: s.triplet,
      });
      pos = end;
    }
    cursor = segEnd;
    if (++guard > 100000) throw new Error("补齐规划异常：循环未收敛");
  }
  return { ...base, fillable: true, rests, failure: null };
}

function newReportId(): string {
  // 离线可用，不强依赖 crypto；存在 crypto.randomUUID 时优先使用
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `report-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e12).toString(36)}`;
}

export function verifyScore(ts: TimeSignatureInput, voices: InputVoice[]): VerifyResult {
  const problems = validateInput(ts, voices);
  if (problems.length) throw new Error(problems.join("；"));

  const barLength = barLengthOf(ts);

  // 先收集同一声部内的重复 id（指向第二次出现的位置）
  const errors: ScoreError[] = [];
  voices.forEach((v, vi) => {
    const seen = new Map<string, number>();
    v.events.forEach((e, ei) => {
      if (seen.has(e.id)) {
        errors.push({
          kind: "duplicateId",
          voiceIndex: vi,
          voiceName: v.name,
          eventId: e.id,
        });
      } else {
        seen.set(e.id, ei);
      }
    });
  });

  let maxEnd: Fraction = ZERO;
  const resultVoices = voices.map((v, vi) => {
    let pos = ZERO;
    const events: EventResult[] = [];
    let segments: DisplaySegment[] = [];
    v.events.forEach((e, ei) => {
      const duration = eventDuration(e);
      const start = pos;
      const end = add(pos, duration);
      const actualBar = Number(floorDiv(start, barLength)) + 1;
      const barOk = e.bar === actualBar;
      if (!barOk) {
        errors.push({
          kind: "barMismatch",
          voiceIndex: vi,
          voiceName: v.name,
          eventIndex: ei,
          eventId: e.id,
          nominalBar: e.bar,
          actualBar,
          start,
        });
      }
      const segs = splitSegments(vi, e, ei, start, end, barLength);
      segments = segments.concat(segs);
      events.push({
        eventIndex: ei,
        id: e.id,
        nominalBar: e.bar,
        denom: e.denom,
        dotted: e.dotted,
        triplet: e.triplet,
        start,
        end,
        duration,
        actualBar,
        barOk,
        segmentCount: segs.length,
      });
      pos = end;
    });
    if (compare(pos, maxEnd) > 0) maxEnd = pos;
    return { name: v.name, events, segments, rawEnd: pos };
  });

  // 共同目标终点：最长声部结束位置之后的第一条完整小节线
  const maxEndBarFloor = floorDiv(maxEnd, barLength);
  const maxOnLine = isMultiple(maxEnd, barLength);
  const targetBars = maxOnLine ? maxEndBarFloor : maxEndBarFloor + 1n;
  const targetEnd = mulInt(barLength, targetBars);

  const voicesWithEnd = resultVoices.map((rv) => {
    const onBarLine = isMultiple(rv.rawEnd, barLength);
    const barCount = floorDiv(rv.rawEnd, barLength);
    const end: VoiceEnd = {
      name: rv.name,
      end: rv.rawEnd,
      barCount,
      onBarLine,
      deficit: sub(targetEnd, rv.rawEnd),
    };
    return { name: rv.name, events: rv.events, segments: rv.segments, end };
  });

  // 最早错误：先按起始位置，再声部序号、再事件序号
  const eventIndexOf = (err: ScoreError): number => {
    if (err.kind === "barMismatch") return err.eventIndex;
    // duplicateId：取第二次出现的下标
    let found = -1;
    voices[err.voiceIndex].events.forEach((e, i) => {
      if (e.id === err.eventId) found = i;
    });
    return found;
  };
  const positionOf = (err: ScoreError): Fraction =>
    err.kind === "barMismatch"
      ? err.start
      : (voicesWithEnd[err.voiceIndex].events[eventIndexOf(err)]?.start ?? ZERO);

  errors.sort((a, b) => {
    const c = compare(positionOf(a), positionOf(b));
    if (c !== 0) return c;
    if (a.voiceIndex !== b.voiceIndex) return a.voiceIndex - b.voiceIndex;
    return eventIndexOf(a) - eventIndexOf(b);
  });
  const firstError = errors[0] ?? null;

  const endAligned = voicesWithEnd.every(
    (v) => compare(v.end.end, targetEnd) === 0,
  );

  // 休止符补齐规划：与结论、时间轴、JSON 导出共用同一份结果，不改写原事件
  const fillVoices = voicesWithEnd.map((v, vi) =>
    planVoiceFill(vi, v.name, v.end.end, targetEnd, barLength),
  );
  const fillPlan: FillPlan = {
    targetEnd,
    targetBars,
    allFillable: fillVoices.every((p) => p.fillable),
    voices: fillVoices,
  };

  return {
    reportId: newReportId(),
    generatedAt: new Date().toISOString(),
    timeSignature: { numerator: ts.numerator, denominator: ts.denominator },
    barLength,
    ticksPerWhole: TICKS_PER_WHOLE,
    voices: voicesWithEnd,
    firstError,
    endAligned,
    targetEnd,
    targetBars,
    fillPlan,
  };
}

// ---------- 导出 JSON（bigint 安全，引用同一份核对结果） ----------

export function resultToJSON(result: VerifyResult): string {
  return JSON.stringify(result, (_key, value) => {
    if (typeof value === "bigint") return { __bigint__: value.toString() };
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === "bigint") {
      return { __frac__: toJSON(value as unknown as Fraction) };
    }
    return value;
  }, 2);
}

/** 仅供测试与下载文件命名 */
export function downloadResult(result: VerifyResult): void {
  const blob = new Blob([resultToJSON(result)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `score-check-${result.reportId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
