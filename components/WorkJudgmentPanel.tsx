"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import {
  CHECKUP_WORK_JUDGMENTS,
  OPINION_PRESETS,
  WORK_JUDGMENT_CONDITIONS,
  buildOpinionNote,
  parseOpinionNote,
} from "@/lib/checkups";

// 就業判定(医師の意見)の入力: officeのみ。RPC経由でログ記録、判定日は保存日
export default function WorkJudgmentPanel({
  checkupId,
  initial,
}: {
  checkupId: string;
  initial: { judgment: string; note: string; date: string; condition?: string | null };
}) {
  const router = useRouter();
  const parsed = parseOpinionNote(initial.note);
  const [judgment, setJudgment] = useState(initial.judgment);
  // 判定条件「受診が条件」: 要医療項目(D)・就業制限項目(R)があるのに通常勤務可とする場合
  const [consult, setConsult] = useState(initial.condition === "consult");
  const [presets, setPresets] = useState<string[]>(parsed.presets);
  const [freeText, setFreeText] = useState(parsed.freeText);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const supabase = createClient();
    // 判定日は指定しない(サーバー側で実行日が自動設定される)
    const { error } = await supabase.rpc("hm_save_work_judgment", {
      p_id: checkupId,
      p_judgment: judgment,
      p_note: buildOpinionNote(presets, freeText),
      p_date: null,
    });
    if (error) {
      setError(`保存に失敗しました: ${error.message}`);
      setBusy(false);
      return;
    }
    // 判定条件は通常勤務可のときだけ保存する(それ以外はサーバー側で消える)
    if (judgment === "normal") {
      const { error: condError } = await supabase.rpc("hm_set_work_judgment_condition", {
        p_ids: [checkupId],
        p_on: consult,
      });
      if (condError) {
        setError(
          `就業判定は保存しましたが、判定条件を保存できませんでした: ${condError.message}` +
            "（データベースの更新(0132)が未適用の可能性があります）"
        );
        setBusy(false);
        router.refresh();
        return;
      }
    }
    setSaved(true);
    router.refresh();
    setBusy(false);
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="form-row" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div>
          <label>就業区分の判定</label>
          <select value={judgment} onChange={(e) => setJudgment(e.target.value)}>
            <option value="">（未判定）</option>
            {Object.entries(CHECKUP_WORK_JUDGMENTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        {judgment === "normal" && (
          <div>
            <label>判定条件</label>
            <label
              htmlFor="wj-consult"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6 }}
            >
              <input
                id="wj-consult"
                type="checkbox"
                checked={consult}
                onChange={(e) => setConsult(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              {WORK_JUDGMENT_CONDITIONS.consult}
              <span className="muted" style={{ fontSize: 12 }}>
                （要医療項目（D）・就業制限項目（R）があるのに通常勤務可とする場合）
              </span>
            </label>
          </div>
        )}
        <div>
          <label>判定日</label>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            保存した日が自動で記録されます
            {initial.date && `（現在: ${initial.date}）`}
          </p>
        </div>
      </div>
      <div className="form-row">
        <label>医師の意見（企業側にも表示されます）</label>
        <div style={{ marginBottom: 6 }}>
          {OPINION_PRESETS.map((p) => (
            <label
              key={p}
              htmlFor={`op-${p}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 14,
                marginRight: 14,
              }}
            >
              <input
                id={`op-${p}`}
                type="checkbox"
                checked={presets.includes(p)}
                onChange={(e) =>
                  setPresets(
                    e.target.checked ? [...presets, p] : presets.filter((x) => x !== p)
                  )
                }
                style={{ width: 16, height: 16 }}
              />
              {p}
            </label>
          ))}
        </div>
        <textarea
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          placeholder="自由記入（時間外労働の制限、業務転換 など）"
          style={{ minHeight: 80 }}
        />
      </div>
      {error && <p className="error-message">{error}</p>}
      {saved && <p style={{ color: "var(--teal-dark)", fontSize: 13 }}>保存しました。</p>}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? "保存中…" : "就業判定を保存"}
      </button>
    </form>
  );
}
