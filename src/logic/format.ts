import { Fraction, frac, fracText, mul } from "./fraction";
import {
  DurationDenominator,
  InputEvent,
  TimeSignatureInput,
  eventDuration,
} from "./score";

const DENOM_LABEL: Record<DurationDenominator, string> = {
  1: "全音符",
  2: "二分",
  4: "四分",
  8: "八分",
  16: "十六分",
  32: "三十二分",
};

export function durationLabel(e: Pick<InputEvent, "denom" | "dotted" | "triplet">): string {
  const parts = [DENOM_LABEL[e.denom]];
  if (e.dotted) parts.push("附点");
  if (e.triplet) parts.push("三连音");
  return parts.join(" · ");
}

export function durationText(e: Pick<InputEvent, "denom" | "dotted" | "triplet">): string {
  return `${fracText(eventDuration(e))} 全音符`;
}

/** 拍数（以拍号分母音符为一拍），保留分数形式 */
export function beatFraction(posFromBarStart: Fraction, ts: TimeSignatureInput): Fraction {
  // 一拍 = 1/denom 全音符，故拍数 = 全音符分数 × denom
  return mul(posFromBarStart, frac(ts.denominator));
}

export function beatText(posFromBarStart: Fraction, ts: TimeSignatureInput): string {
  return `${fracText(beatFraction(posFromBarStart, ts))} 拍`;
}

export function wholeText(f: Fraction): string {
  return `${fracText(f)} 全音符`;
}
