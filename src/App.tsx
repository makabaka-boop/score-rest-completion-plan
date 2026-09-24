import {
  DURATION_DENOMINATORS,
  DurationDenominator,
  InputEvent,
  InputVoice,
  TimeSignatureInput,
  validateInput,
  verifyScore,
} from "./logic/score";
import { useMemo, useState } from "react";
import { Timeline } from "./components/Timeline";
import { ReportView } from "./components/ReportView";
import { VoiceEditor } from "./components/VoiceEditor";

const VOICE_COLORS = ["#2563eb", "#0d9488", "#d97706", "#9333ea"];

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}${idCounter}`;
}

function makeEvent(bar: number): InputEvent {
  return { id: nextId("ev-"), bar, denom: 4, dotted: false, triplet: false };
}

function seedVoices(): { voices: InputVoice[] } {
  // 默认演示：4/4 下，S 声部 6 个四分三连音 + 4 个四分 = 2 小节；
  // A 声部 2 个全音符。全部恰好落在小节线上。
  const triplets: InputEvent[] = Array.from({ length: 6 }, () =>
    makeEvent(1),
  ).map((e) => ({ ...e, denom: 4 as DurationDenominator, triplet: true }));
  const quarters = [makeEvent(2), makeEvent(2), makeEvent(2), makeEvent(2)];
  return {
    voices: [
      { name: "S 声部", events: [...triplets, ...quarters] },
      { name: "A 声部", events: [makeEvent(1), makeEvent(2)].map((e) => ({ ...e, denom: 1 })) },
    ],
  };
}

function signatureOf(ts: TimeSignatureInput, voices: InputVoice[]): string {
  return JSON.stringify({ ts, voices });
}

export default function App() {
  const seeded = useMemo(seedVoices, []);
  const [ts, setTs] = useState<TimeSignatureInput>({ numerator: 4, denominator: 4 });
  const [voices, setVoices] = useState<InputVoice[]>(seeded.voices);
  const [result, setResult] = useState(() => verifyScore({ numerator: 4, denominator: 4 }, seeded.voices));
  const [resultSig, setResultSig] = useState(() =>
    signatureOf({ numerator: 4, denominator: 4 }, seeded.voices),
  );

  const currentSig = signatureOf(ts, voices);
  const stale = currentSig !== resultSig;
  const problems = validateInput(ts, voices);

  function runCheck() {
    const r = verifyScore(ts, voices);
    setResult(r);
    setResultSig(signatureOf(ts, voices));
  }

  // ---------- 编辑操作（每次编辑都会使旧结论失效） ----------

  function patchTs(patch: Partial<TimeSignatureInput>) {
    setTs((t) => ({ ...t, ...patch }));
  }

  function patchVoice(vi: number, patch: Partial<InputVoice>) {
    setVoices((vs) => vs.map((v, i) => (i === vi ? { ...v, ...patch } : v)));
  }

  function patchEvent(vi: number, ei: number, patch: Partial<InputEvent>) {
    setVoices((vs) =>
      vs.map((v, i) =>
        i === vi
          ? {
              ...v,
              events: v.events.map((e, j) => (j === ei ? { ...e, ...patch } : e)),
            }
          : v,
      ),
    );
  }

  function addEvent(vi: number) {
    setVoices((vs) =>
      vs.map((v, i) =>
        i === vi && v.events.length < 120
          ? { ...v, events: [...v.events, makeEvent(1)] }
          : v,
      ),
    );
  }

  function removeEvent(vi: number, ei: number) {
    setVoices((vs) =>
      vs.map((v, i) =>
        i === vi && v.events.length > 1
          ? { ...v, events: v.events.filter((_, j) => j !== ei) }
          : v,
      ),
    );
  }

  function addVoice() {
    setVoices((vs) =>
      vs.length < 4 ? [...vs, { name: `声部 ${vs.length + 1}`, events: [makeEvent(1)] }] : vs,
    );
  }

  function removeVoice(vi: number) {
    setVoices((vs) => (vs.length > 1 ? vs.filter((_, i) => i !== vi) : vs));
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>多声部排练谱 · 小节对齐核对台</h1>
          <p className="subtitle">
            全程整数分数（bigint 有理数）累加 · 附点 ×3/2 · 三连音 ×2/3 · 离线纯前端
          </p>
        </div>
        <div className="topbar-actions">
          {stale && (
            <span className="stale-badge" data-testid="stale-badge">
              输入已修改，以下为旧结论，请重新核对
            </span>
          )}
          <button
            type="button"
            className="primary"
            onClick={runCheck}
            disabled={problems.length > 0}
            data-testid="run-check"
          >
            重新核对
          </button>
        </div>
      </header>

      {problems.length > 0 && (
        <div className="problems" data-testid="problems">
          <strong>输入问题：</strong>
          {problems.join("；")}
        </div>
      )}

      <section className="panel">
        <h2>拍号</h2>
        <div className="ts-row">
          <label>
            每小节拍数（分子 2–12）
            <select
              aria-label="拍号分子"
              value={ts.numerator}
              onChange={(e) => patchTs({ numerator: Number(e.target.value) })}
            >
              {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            以几分音符为一拍（分母）
            <select
              aria-label="拍号分母"
              value={ts.denominator}
              onChange={(e) => patchTs({ denominator: Number(e.target.value) as 4 | 8 })}
            >
              <option value={4}>4（四分音符为一拍）</option>
              <option value={8}>8（八分音符为一拍）</option>
            </select>
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>声部与事件（{voices.length}/4）</h2>
          <button type="button" onClick={addVoice} disabled={voices.length >= 4}>
            添加声部
          </button>
        </div>
        {voices.map((v, vi) => (
          <VoiceEditor
            key={vi}
            voice={v}
            index={vi}
            color={VOICE_COLORS[vi % VOICE_COLORS.length]}
            canRemove={voices.length > 1}
            onPatch={(patch) => patchVoice(vi, patch)}
            onPatchEvent={(ei, patch) => patchEvent(vi, ei, patch)}
            onAddEvent={() => addEvent(vi)}
            onRemoveEvent={(ei) => removeEvent(vi, ei)}
            onRemove={() => removeVoice(vi)}
          />
        ))}
      </section>

      <section className="panel">
        <h2>并列时间轴</h2>
        <Timeline result={result} colors={VOICE_COLORS} stale={stale} />
      </section>

      <section className="panel">
        <h2>核对结论{stale && <span className="stale-tag">（旧）</span>}</h2>
        <ReportView result={result} stale={stale} />
      </section>

      <footer className="foot">
        <span>时值分母可选：{DURATION_DENOMINATORS.join(" / ")}（全 / 二分 / 四分 / 八分 / 十六分 / 三十二分）</span>
      </footer>
    </div>
  );
}
