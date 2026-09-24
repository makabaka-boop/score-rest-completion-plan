import { DURATION_DENOMINATORS, InputEvent, InputVoice } from "../logic/score";
import { durationLabel, durationText } from "../logic/format";

interface Props {
  voice: InputVoice;
  index: number;
  color: string;
  canRemove: boolean;
  onPatch: (patch: Partial<InputVoice>) => void;
  onPatchEvent: (ei: number, patch: Partial<InputEvent>) => void;
  onAddEvent: () => void;
  onRemoveEvent: (ei: number) => void;
  onRemove: () => void;
}

export function VoiceEditor({
  voice,
  index,
  color,
  canRemove,
  onPatch,
  onPatchEvent,
  onAddEvent,
  onRemoveEvent,
  onRemove,
}: Props) {
  return (
    <div className="voice-editor" style={{ borderLeftColor: color }}>
      <div className="voice-head">
        <span className="voice-swatch" style={{ background: color }} />
        <input
          className="voice-name"
          aria-label={`声部 ${index + 1} 名称`}
          value={voice.name}
          onChange={(e) => onPatch({ name: e.target.value })}
        />
        <span className="event-count">{voice.events.length} 个事件（顺序录入）</span>
        <button type="button" onClick={onAddEvent} disabled={voice.events.length >= 120}>
          追加事件
        </button>
        {canRemove && (
          <button type="button" className="danger" onClick={onRemove}>
            删除声部
          </button>
        )}
      </div>
      <table className="event-table">
        <thead>
          <tr>
            <th>#</th>
            <th>id（唯一）</th>
            <th>标称小节</th>
            <th>时值分母</th>
            <th>附点</th>
            <th>三连音</th>
            <th>时值</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {voice.events.map((e, ei) => (
            <tr key={e.id}>
              <td className="col-index">{ei + 1}</td>
              <td>
                <input
                  aria-label={`事件 id ${ei + 1}`}
                  value={e.id}
                  onChange={(ev2) => onPatchEvent(ei, { id: ev2.target.value })}
                />
              </td>
              <td>
                <input
                  aria-label={`标称小节号 ${ei + 1}`}
                  className="bar-input"
                  type="number"
                  min={1}
                  value={e.bar}
                  onChange={(ev2) => onPatchEvent(ei, { bar: Number(ev2.target.value) })}
                />
              </td>
              <td>
                <select
                  aria-label={`时值分母 ${ei + 1}`}
                  value={e.denom}
                  onChange={(ev2) =>
                    onPatchEvent(ei, { denom: Number(ev2.target.value) as InputEvent["denom"] })
                  }
                >
                  {DURATION_DENOMINATORS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </td>
              <td className="col-check">
                <input
                  aria-label={`附点 ${ei + 1}`}
                  type="checkbox"
                  checked={e.dotted}
                  onChange={(ev2) => onPatchEvent(ei, { dotted: ev2.target.checked })}
                />
              </td>
              <td className="col-check">
                <input
                  aria-label={`三连音 ${ei + 1}`}
                  type="checkbox"
                  checked={e.triplet}
                  onChange={(ev2) => onPatchEvent(ei, { triplet: ev2.target.checked })}
                />
              </td>
              <td className="dur-hint" title={durationText(e)}>
                {durationLabel(e)}
                <span className="dur-frac">{durationText(e)}</span>
              </td>
              <td>
                <button
                  type="button"
                  className="danger small"
                  disabled={voice.events.length <= 1}
                  onClick={() => onRemoveEvent(ei)}
                >
                  删
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
