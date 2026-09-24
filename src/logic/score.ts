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
  restPlan: RestPlan; // 休止符补齐规划（与结论同时生成，时间轴/清单/下载共用）
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

  const assembled: Omit<VerifyResult, "restPlan"> = {
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
  };
  // 补齐规划与核对结论同源生成，之后清单、时间轴提示、下载 JSON 引用同一份结果
  return { ...assembled, restPlan: planRestCompletion(assembled) };
}

// ---------- 休止符补齐规划 ----------

/** 一枚休止符可用的时值属性（与事件时值同一词汇表：分母 × 附点 × 三连音） */
export interface RestDurationSpec {
  denom: DurationDenominator;
  dotted: boolean;
  triplet: boolean;
  /** 时值（1/192 全音符整数刻度） */
  ticks: number;
}

// 修饰符数量：同一刻度有多个写法时，保留最简者（附点+三连音恒等于无修饰，不进入清单）
function modifierCount(dotted: boolean, triplet: boolean): number {
  return (dotted ? 1 : 0) + (triplet ? 1 : 0);
}

function buildRestDurationTable(): RestDurationSpec[] {
  const byTicks = new Map<number, RestDurationSpec>();
  for (const denom of DURATION_DENOMINATORS) {
    for (const dotted of [false, true]) {
      for (const triplet of [false, true]) {
        const ticks = toTicks(eventDuration({ denom, dotted, triplet }));
        const prev = byTicks.get(ticks);
        if (
          !prev ||
          modifierCount(dotted, triplet) < modifierCount(prev.dotted, prev.triplet)
        ) {
          byTicks.set(ticks, { denom, dotted, triplet, ticks });
        }
      }
    }
  }
  // 从长到短排列，配合“并列时较长时值优先”的扫描顺序
  return [...byTicks.values()].sort((a, b) => b.ticks - a.ticks);
}

/** 全部合法休止符时值（按时值从长到短；同一刻度只保留最简写法） */
export const REST_DURATION_TABLE: RestDurationSpec[] = buildRestDurationTable();

/** 缺口被小节边界切分出的一段（任何一枚休止符都不得跨过小节线） */
export interface GapSegment {
  bar: number; // 段所在实际小节（1 起）
  start: Fraction; // 段起点（全音符分数）
  end: Fraction; // 段终点
  ticks: number; // 段长（1/192 全音符整数刻度）
}

/** 把 [start, end) 的缺口按小节线拆成若干段（端点按半开区间处理） */
export function splitGapByBars(
  start: Fraction,
  end: Fraction,
  barLength: Fraction,
): GapSegment[] {
  const segments: GapSegment[] = [];
  let cursor = start;
  let guard = 0;
  while (compare(cursor, end) < 0) {
    const bar = Number(floorDiv(cursor, barLength)) + 1;
    const barStart = mulInt(barLength, bar - 1);
    const barEnd = add(barStart, barLength);
    const segEnd = compare(barEnd, end) <= 0 ? barEnd : end;
    segments.push({
      bar,
      start: cursor,
      end: segEnd,
      ticks: toTicks(sub(segEnd, cursor)),
    });
    cursor = segEnd;
    if (++guard > 100000) throw new Error("缺口拆分异常：循环未收敛");
  }
  return segments;
}

// 序列比较：符号数少者优；并列时从前往后时值较长者优。返回负数表示 a 更优。
function compareRestSeq(a: RestDurationSpec[], b: RestDurationSpec[]): number {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i++) {
    if (a[i].ticks !== b[i].ticks) return b[i].ticks - a[i].ticks;
  }
  return 0;
}

/**
 * 用合法休止符时值精确组成 ticks 刻度的一段：
 * 符号数最少；符号数并列时从前往后时值较长者优先（结果唯一，时值从长到短排列）。
 * 无法由允许时值精确组成时返回 null。
 */
export function fillSegmentTicks(ticks: number): RestDurationSpec[] | null {
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new Error(`段长 ${ticks} 不是非负整数刻度`);
  }
  // best[l]：精确组成 l 刻度的最优序列（整数刻度上的动态规划）
  const best: (RestDurationSpec[] | null)[] = new Array(ticks + 1).fill(null);
  best[0] = [];
  for (let l = 1; l <= ticks; l++) {
    for (const d of REST_DURATION_TABLE) {
      if (d.ticks > l) continue;
      const rest = best[l - d.ticks];
      if (rest === null) continue;
      const cand = [d, ...rest];
      const cur = best[l];
      if (cur === null || compareRestSeq(cand, cur) < 0) best[l] = cand;
    }
  }
  return best[ticks];
}

/** 补齐清单中的一枚休止符 */
export interface RestItem {
  voiceIndex: number;
  voiceName: string;
  bar: number; // 所在实际小节（1 起）
  start: Fraction; // 起点（全音符分数）
  end: Fraction; // 终点
  duration: Fraction; // 时值
  denom: DurationDenominator;
  dotted: boolean;
  triplet: boolean;
}

/** 无法由允许时值精确组成的缺口段 */
export interface RestGapFailure {
  voiceIndex: number;
  voiceName: string;
  bar: number;
  start: Fraction;
  end: Fraction;
  ticks: number; // 段长（1/192 全音符整数刻度）
}

export interface RestPlan {
  /** 所有短声部的缺口都能精确补齐 */
  ok: boolean;
  /** 完整补齐清单；存在不可补齐段时为空（不生成貌似对齐的部分清单） */
  items: RestItem[];
  failures: RestGapFailure[];
}

/**
 * 基于核对结果，为每个短声部从其精确结束位置补到共同目标小节线。
 * 先按小节边界拆分缺口，再对每段用整数刻度求符号数最少的组合；
 * 不改写原音符与原核对结论。任一段不可补齐时 items 为空。
 */
export function planRestCompletion(result: Omit<VerifyResult, "restPlan">): RestPlan {
  const items: RestItem[] = [];
  const failures: RestGapFailure[] = [];
  result.voices.forEach((v, vi) => {
    if (compare(v.end.end, result.targetEnd) >= 0) return; // 该声部已到达目标小节线
    const segments = splitGapByBars(v.end.end, result.targetEnd, result.barLength);
    for (const seg of segments) {
      const seq = fillSegmentTicks(seg.ticks);
      if (seq === null) {
        failures.push({
          voiceIndex: vi,
          voiceName: v.name,
          bar: seg.bar,
          start: seg.start,
          end: seg.end,
          ticks: seg.ticks,
        });
        continue;
      }
      let pos = seg.start;
      for (const d of seq) {
        const duration = eventDuration(d);
        const endPos = add(pos, duration);
        items.push({
          voiceIndex: vi,
          voiceName: v.name,
          bar: seg.bar,
          start: pos,
          end: endPos,
          duration,
          denom: d.denom,
          dotted: d.dotted,
          triplet: d.triplet,
        });
        pos = endPos;
      }
    }
  });
  const ok = failures.length === 0;
  return { ok, items: ok ? items : [], failures };
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
