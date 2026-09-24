import { useMemo } from "react";
import { Fraction, fracText, mulInt, sub } from "../logic/fraction";
import {
  TICKS_PER_WHOLE,
  VerifyResult,
  toTicks,
} from "../logic/score";

interface Props {
  result: VerifyResult;
  colors: string[];
  stale: boolean;
}

const PX_PER_WHOLE = 160; // 每全音符 160px，一个 4/4 小节即 160px

export function Timeline({ result, colors, stale }: Props) {
  const targetTicks = toTicks(result.targetEnd);
  const widthPx = Math.max(320, (targetTicks / TICKS_PER_WHOLE) * PX_PER_WHOLE + 24);
  const targetBars = Number(result.targetBars);
  const barLength = result.barLength;

  const bars = useMemo(() => {
    return Array.from({ length: Math.max(targetBars, 1) }, (_, i) => i + 1);
  }, [targetBars]);

  const xOf = (f: Fraction) => (toTicks(f) / TICKS_PER_WHOLE) * PX_PER_WHOLE;

  const firstErrorKey =
    result.firstError?.kind === "barMismatch"
      ? `${result.firstError.voiceIndex}:${result.firstError.eventId}`
      : null;

  return (
    <div className={`timeline ${stale ? "stale" : ""}`}>
      <div className="timeline-scroll" data-testid="timeline">
        <div className="timeline-inner" style={{ width: widthPx }}>
          {/* 小节刻度行 */}
          <div className="ruler" style={{ height: 22 }}>
            {bars.map((b) => {
              const barStart = mulInt(barLength, b - 1);
              return (
                <div
                  key={b}
                  className="bar-label"
                  style={{ left: xOf(barStart), width: xOf(barLength) }}
                >
                  小节 {b}
                </div>
              );
            })}
            {bars.map((b) => (
              <div
                key={`line-${b}`}
                className="bar-line-ruler"
                style={{ left: xOf(mulInt(barLength, b - 1)) }}
              />
            ))}
          </div>

          {result.voices.map((v, vi) => {
            const endTicks = toTicks(v.end.end);
            const deficitTicks = targetTicks - endTicks;
            return (
              <div className="track-row" key={`${v.name}-${vi}`}>
                <div className="track-label" style={{ color: colors[vi % colors.length] }}>
                  {v.name}
                </div>
                <div className="track" style={{ width: xOf(result.targetEnd) }}>
                  {/* 小节竖线 */}
                  {bars.map((b) => (
                    <div
                      key={b}
                      className={`bar-line ${b === bars.length ? "final" : ""}`}
                      style={{ left: xOf(mulInt(barLength, b)) }}
                    />
                  ))}

                  {/* 片段 */}
                  {v.segments.map((s, si) => {
                    const left = xOf(s.start);
                    const w = xOf(s.duration);
                    const isFirstErr =
                      firstErrorKey === `${vi}:${s.eventId}`;
                    return (
                      <div
                        key={`${s.eventId}-${si}`}
                        className={`seg ${isFirstErr ? "seg-error" : ""} ${
                          s.duration[1] !== 1n ? "seg-fraction" : ""
                        }`}
                        style={{
                          left,
                          width: Math.max(w, 2),
                          background: colors[vi % colors.length],
                        }}
                        title={`事件 ${s.eventId} · 小节 ${s.bar} · 片段时长 ${s.duration[0]}/${s.duration[1]} 全音符`}
                        data-event-id={s.eventId}
                        data-bar={s.bar}
                      >
                        <span className="seg-id">{s.eventId}</span>
                        <span className="seg-dur">
                          {s.duration[1] === 1n
                            ? s.duration[0].toString()
                            : `${s.duration[0]}/${s.duration[1]}`}
                        </span>
                      </div>
                    );
                  })}

                  {/* 未补足区域 */}
                  {deficitTicks > 0 && (
                    <div
                      className="deficit-zone"
                      style={{
                        left: xOf(v.end.end),
                        width: xOf(sub(result.targetEnd, v.end.end)),
                      }}
                      data-testid={`deficit-${vi}`}
                      title={`未补足 ${v.end.deficit[0]}/${v.end.deficit[1]} 全音符`}
                    >
                      缺{" "}
                      {v.end.deficit[1] === 1n
                        ? v.end.deficit[0].toString()
                        : `${v.end.deficit[0]}/${v.end.deficit[1]}`}
                    </div>
                  )}

                  {/* 结束位置不在整小节线上的标记 */}
                  {!v.end.onBarLine && (
                    <div className="ragged-end" style={{ left: xOf(v.end.end) }} />
                  )}
                  <div className="track-end-label" style={{ left: xOf(v.end.end) }}>
                    {fracText(v.end.end)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="timeline-note">
        最小公共刻度 1/{TICKS_PER_WHOLE} 全音符（全音符分数累加，未使用浮点）。色块为跨小节拆分后的显示片段，
        同一 id 的片段属于同一事件；斜纹区为该声部距共同小节线的精确差额。
      </p>
    </div>
  );
}
