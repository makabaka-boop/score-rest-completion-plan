import { VerifyResult, downloadResult } from "../logic/score";
import { Fraction, frac, fracText, mulInt, sub } from "../logic/fraction";
import { beatText, durationLabel } from "../logic/format";

interface Props {
  result: VerifyResult;
  stale: boolean;
}

export function ReportView({ result, stale }: Props) {
  return (
    <div className="report" data-testid="report">
      <div className="report-meta">
        <span>
          拍号 {result.timeSignature.numerator}/{result.timeSignature.denominator}（小节长{" "}
          {fracText(result.barLength)} 全音符）
        </span>
        <span>共同目标：{result.targetBars.toString()} 个完整小节（{fracText(result.targetEnd)} 全音符）</span>
        <span className="mono">报告 id：{result.reportId}</span>
        <button
          type="button"
          className="primary"
          disabled={stale}
          onClick={() => downloadResult(result)}
          data-testid="download-json"
          title={stale ? "输入已修改，重新核对后才能下载当前结论" : "下载本结论 JSON"}
        >
          下载结论 JSON
        </button>
      </div>

      <FirstErrorCard result={result} />
      <EndingCard result={result} />
      <RestPlanCard result={result} />

      {result.voices.map((v, vi) => (
        <details key={`${v.name}-${vi}`} className="voice-details">
          <summary>
            {v.name}：{v.events.length} 事件 / {v.segments.length} 显示片段 · 结束于{" "}
            {fracText(v.end.end)} 全音符
            {v.end.onBarLine ? "（小节线上）" : "（不在小节线上）"}
          </summary>
          <table className="event-table compact">
            <thead>
              <tr>
                <th>#</th>
                <th>id</th>
                <th>时值</th>
                <th>起点</th>
                <th>终点</th>
                <th>实际起始小节</th>
                <th>标称小节</th>
                <th>片段数</th>
                <th>判定</th>
              </tr>
            </thead>
            <tbody>
              {v.events.map((e) => {
                const barStart = mulInt(result.barLength, e.actualBar - 1);
                const inBar = sub(e.start, barStart);
                const bad =
                  result.firstError?.kind === "barMismatch" &&
                  result.firstError.voiceIndex === vi &&
                  result.firstError.eventId === e.id;
                return (
                  <tr key={e.id} className={bad ? "row-first-error" : ""}>
                    <td>{e.eventIndex + 1}</td>
                    <td className="mono">{e.id}</td>
                    <td>
                      {durationLabel(e)}（{fracText(e.duration)}）
                    </td>
                    <td className="mono">
                      {fracText(e.start)}
                      <span className="beat-hint">（小节内 {beatText(inBar, result.timeSignature)}）</span>
                    </td>
                    <td className="mono">{fracText(e.end)}</td>
                    <td>{e.actualBar}</td>
                    <td>{e.nominalBar}</td>
                    <td>{e.segmentCount}</td>
                    <td>{e.barOk ? "✓" : "✗"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h4>显示片段（跨小节拆分，保持原 id）</h4>
          <table className="event-table compact">
            <thead>
              <tr>
                <th>事件 id</th>
                <th>小节</th>
                <th>片段起点</th>
                <th>片段终点</th>
                <th>片段时长</th>
              </tr>
            </thead>
            <tbody>
              {v.segments.map((s, i) => (
                <tr key={`${s.eventId}-${i}`}>
                  <td className="mono">{s.eventId}</td>
                  <td>{s.bar}</td>
                  <td className="mono">{fracText(s.start)}</td>
                  <td className="mono">{fracText(s.end)}</td>
                  <td className="mono">{fracText(s.duration)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
    </div>
  );
}

function FirstErrorCard({ result }: { result: VerifyResult }) {
  const err = result.firstError;
  if (!err) {
    return (
      <div className="card ok" data-testid="first-error-card">
        <strong>小节号核对：</strong>所有事件的标称小节号均与有理数复算的实际起始小节一致。
      </div>
    );
  }
  return (
    <div className="card bad" data-testid="first-error-card">
      <strong>最早错误：</strong>
      {err.kind === "barMismatch" ? (
        <span>
          声部「{err.voiceName}」事件 <span className="mono">{err.eventId}</span>{" "}
          （第 {err.eventIndex + 1} 个）标称小节 {err.nominalBar}，实际起始小节为{" "}
          <strong>{err.actualBar}</strong>；起点为 {fracText(err.start as Fraction)} 全音符。
          <br />
          该事件之后的事件即使小节号相同也可能被连带错位，请先修正此处再重新核对。
        </span>
      ) : (
        <span>
          声部「{err.voiceName}」内事件 id 重复：<span className="mono">{err.eventId}</span>
          （每个事件的 id 在同一声部内必须唯一）。
        </span>
      )}
    </div>
  );
}

function RestPlanCard({ result }: { result: VerifyResult }) {
  const plan = result.restPlan;
  if (plan.ok && plan.items.length === 0) {
    return (
      <div className="card ok" data-testid="rest-plan-card">
        <strong>休止符补齐：</strong>所有声部均已到达共同小节线，无需补齐。
      </div>
    );
  }
  if (!plan.ok) {
    return (
      <div className="card bad" data-testid="rest-plan-card">
        <strong>无法生成补齐清单：</strong>以下缺口不能由允许时值（分母 1–32、附点、三连音）
        精确组成；为避免貌似对齐的部分清单，本次不给出任何休止符。
        <table className="event-table compact deficit-table">
          <thead>
            <tr>
              <th>声部</th>
              <th>小节</th>
              <th>缺口起点</th>
              <th>缺口终点</th>
              <th>段长</th>
            </tr>
          </thead>
          <tbody>
            {plan.failures.map((f, i) => (
              <tr key={`${f.voiceIndex}-${f.bar}-${i}`}>
                <td>{f.voiceName}</td>
                <td>{f.bar}</td>
                <td className="mono">{fracText(f.start)}</td>
                <td className="mono">{fracText(f.end)}</td>
                <td className="mono">
                  {fracText(frac(f.ticks, result.ticksPerWhole))} 全音符
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="card ok" data-testid="rest-plan-card">
      <strong>休止符补齐清单</strong>
      （可直接照抄：每枚都不跨小节线；各段符号数最少，并列时较长时值在前）：
      <table className="event-table compact deficit-table" data-testid="rest-plan-table">
        <thead>
          <tr>
            <th>#</th>
            <th>声部</th>
            <th>小节</th>
            <th>起点</th>
            <th>终点</th>
            <th>休止符时值</th>
          </tr>
        </thead>
        <tbody>
          {plan.items.map((it, i) => (
            <tr key={`${it.voiceIndex}-${i}`} data-testid="rest-plan-row">
              <td>{i + 1}</td>
              <td>{it.voiceName}</td>
              <td>{it.bar}</td>
              <td className="mono">{fracText(it.start)}</td>
              <td className="mono">{fracText(it.end)}</td>
              <td>
                {durationLabel(it)}（{fracText(it.duration)}）
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EndingCard({ result }: { result: VerifyResult }) {
  if (result.endAligned) {
    return (
      <div className="card ok" data-testid="ending-card">
        <strong>结尾对齐：</strong>
        {result.voices.length} 个声部均结束于同一完整小节线（{result.targetBars.toString()} 小节，
        {fracText(result.targetEnd)} 全音符）。
      </div>
    );
  }
  return (
    <div className="card bad" data-testid="ending-card">
      <strong>结尾未对齐：</strong>共同目标为 {result.targetBars.toString()} 个完整小节（
      {fracText(result.targetEnd)} 全音符）。以下声部未补足：
      <table className="event-table compact deficit-table">
        <thead>
          <tr>
            <th>声部</th>
            <th>结束位置</th>
            <th>完整小节数</th>
            <th>结束于小节线</th>
            <th>精确差额（到共同小节线）</th>
          </tr>
        </thead>
        <tbody>
          {result.voices.map((v, vi) => (
            <tr key={`${v.name}-${vi}`} className={v.end.deficit[0] === 0n ? "" : "row-deficit"}>
              <td>{v.name}</td>
              <td className="mono">{fracText(v.end.end)}</td>
              <td>{v.end.barCount.toString()}</td>
              <td>{v.end.onBarLine ? "是" : "否"}</td>
              <td className="mono">
                {v.end.deficit[0] === 0n ? "—" : `${fracText(v.end.deficit)} 全音符`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
