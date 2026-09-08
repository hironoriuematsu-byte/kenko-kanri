"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { LEGAL_ITEMS, type JudgmentRule } from "@/lib/judgment";

const SEX_LABEL: Record<string, string> = { all: "共通", male: "男性", female: "女性" };

// 事務所の自動判定基準の編集(officeのみ)
export default function JudgmentRulesEditor({ initial }: { initial: JudgmentRule[] }) {
  const router = useRouter();
  const [rules, setRules] = useState<JudgmentRule[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const setField = (id: string, patch: Partial<JudgmentRule>) =>
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

  const save = async (r: JudgmentRule) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const supabase = createClient();
    const { error } = await supabase
      .from("hm_judgment_rules")
      .update({
        grade: r.grade,
        min_value: r.min_value,
        max_value: r.max_value,
        match_text: r.match_text,
      })
      .eq("id", r.id!);
    if (error) setError(`保存に失敗しました: ${error.message}`);
    else {
      setSaved(true);
      router.refresh();
    }
    setBusy(false);
  };

  const saveAll = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const supabase = createClient();
    for (const r of rules) {
      const { error } = await supabase
        .from("hm_judgment_rules")
        .update({
          grade: r.grade,
          min_value: r.min_value,
          max_value: r.max_value,
          match_text: r.match_text,
        })
        .eq("id", r.id!);
      if (error) {
        setError(`保存に失敗しました: ${error.message}`);
        setBusy(false);
        return;
      }
    }
    setSaved(true);
    setBusy(false);
    router.refresh();
  };

  const addRule = async (itemKey: string, itemLabel: string, sex: string) => {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("hm_judgment_rules")
      .insert({
        item_key: itemKey,
        item_label: itemLabel,
        sex,
        grade: "C",
        sort_order: 99,
      })
      .select("id, item_key, item_label, unit, sex, grade, min_value, max_value, match_text, sort_order")
      .single();
    if (error || !data) {
      setError(`追加に失敗しました: ${error?.message ?? "unknown"}`);
      setBusy(false);
      return;
    }
    setRules((prev) => [...prev, data as JudgmentRule]);
    setBusy(false);
  };

  const removeRule = async (id: string) => {
    if (!window.confirm("この判定ルールを削除します。よろしいですか？")) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("hm_judgment_rules").delete().eq("id", id);
    if (error) {
      setError(`削除に失敗しました: ${error.message}`);
      setBusy(false);
      return;
    }
    setRules((prev) => prev.filter((r) => r.id !== id));
    setBusy(false);
  };

  const byItem = LEGAL_ITEMS.map((it) => ({
    ...it,
    rules: rules.filter((r) => r.item_key === it.key),
  }));

  return (
    <div>
      {error && <p className="error-message">{error}</p>}
      {saved && <p style={{ color: "var(--teal-dark)", fontSize: 13 }}>保存しました。</p>}
      <p>
        <button className="btn" onClick={saveAll} disabled={busy}>
          {busy ? "保存中…" : "すべての変更を保存"}
        </button>
      </p>

      {byItem.map((item) => (
        <div key={item.key} className="card" style={{ background: "#fbfdfd" }}>
          <h3 style={{ fontSize: 15, color: "var(--teal-dark)", margin: "0 0 8px" }}>
            {item.label}
            {item.unit && <span className="muted">（{item.unit}）</span>}
            {item.sexSpecific && <span className="badge" style={{ marginLeft: 8 }}>性別あり</span>}
          </h3>
          {item.rules.length === 0 ? (
            <p className="muted">基準未設定（この項目は判定されません）</p>
          ) : (
            <table className="list" style={{ marginBottom: 8 }}>
              <thead>
                <tr>
                  <th style={{ width: 70 }}>対象</th>
                  <th style={{ width: 80 }}>判定</th>
                  <th>下限（以上）</th>
                  <th>上限（以下）</th>
                  <th>定性一致</th>
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {item.rules.map((r) => (
                  <tr key={r.id}>
                    <td>{SEX_LABEL[r.sex]}</td>
                    <td>
                      <select
                        value={r.grade}
                        onChange={(e) =>
                          setField(r.id!, { grade: e.target.value as JudgmentRule["grade"] })
                        }
                        onBlur={() => save(r)}
                      >
                        <option value="B">B</option>
                        <option value="C">C</option>
                        <option value="D">D</option>
                        <option value="R">R（就業制限の検討）</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        step="any"
                        value={r.min_value ?? ""}
                        onChange={(e) => setField(r.id!, { min_value: numOrNull(e.target.value) })}
                        onBlur={() => save(r)}
                        placeholder="なし"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="any"
                        value={r.max_value ?? ""}
                        onChange={(e) => setField(r.id!, { max_value: numOrNull(e.target.value) })}
                        onBlur={() => save(r)}
                        placeholder="なし"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={r.match_text ?? ""}
                        onChange={(e) =>
                          setField(r.id!, { match_text: e.target.value || null })
                        }
                        onBlur={() => save(r)}
                        placeholder="±、+ など"
                        style={{ width: 90 }}
                      />
                    </td>
                    <td>
                      <button
                        className="btn danger"
                        style={{ padding: "3px 10px", fontSize: 12 }}
                        onClick={() => removeRule(r.id!)}
                        disabled={busy}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(item.sexSpecific ? ["male", "female"] : ["all"]).map((sex) => (
              <button
                key={sex}
                className="btn secondary"
                style={{ padding: "3px 12px", fontSize: 12 }}
                onClick={() => addRule(item.key, item.label, sex)}
                disabled={busy}
              >
                ＋ ルールを追加（{SEX_LABEL[sex]}）
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
