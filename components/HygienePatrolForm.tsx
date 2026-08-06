"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { CHECKLIST_TYPES, RESULT_LABELS, type ChecklistResult } from "@/lib/hygiene";

export type HygienePatrolInput = {
  id?: string;
  company_id: string;
  patrol_date: string;
  checklist_type: string;
  inspector_name: string;
  results: ChecklistResult[];
  summary: string;
};

// 衛生管理者巡視記録(チェックリスト形式)の作成・編集
export default function HygienePatrolForm({
  initial,
  itemsByType,
  backHref,
}: {
  initial: HygienePatrolInput;
  itemsByType: Record<string, string[]>; // 種別ごとのチェックリスト項目(新規作成時に使用)
  backHref: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<HygienePatrolInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isEdit = !!initial.id;

  const switchType = (type: string) => {
    setV((p) => ({
      ...p,
      checklist_type: type,
      results: (itemsByType[type] ?? []).map((item) => ({
        item,
        result: "ok",
        note: "",
      })),
    }));
  };

  const setResult = (i: number, patch: Partial<ChecklistResult>) =>
    setV((p) => ({
      ...p,
      results: p.results.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: authUser } = await supabase.auth.getUser();

    const payload = {
      company_id: v.company_id,
      patrol_date: v.patrol_date,
      checklist_type: v.checklist_type,
      inspector_name: v.inspector_name.trim() || null,
      results: v.results,
      summary: v.summary.trim() || null,
    };

    let id = v.id;
    if (id) {
      const { error } = await supabase
        .from("hm_hygiene_patrols")
        .update(payload)
        .eq("id", id);
      if (error) {
        setError(`保存に失敗しました: ${error.message}`);
        setBusy(false);
        return;
      }
      await supabase.rpc("hm_log_access", {
        p_action: "update",
        p_target_table: "hm_hygiene_patrols",
        p_target_id: id,
      });
    } else {
      const { data, error } = await supabase
        .from("hm_hygiene_patrols")
        .insert({ ...payload, created_by: authUser.user?.id })
        .select("id")
        .single();
      if (error || !data) {
        setError(`作成に失敗しました: ${error?.message ?? "unknown"}`);
        setBusy(false);
        return;
      }
      id = data.id;
      await supabase.rpc("hm_log_access", {
        p_action: "create",
        p_target_table: "hm_hygiene_patrols",
        p_target_id: id,
      });
    }
    router.replace(`/hygiene-patrols/${id}`);
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="form-row" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div>
          <label>巡視日 *</label>
          <input
            type="date"
            value={v.patrol_date}
            onChange={(e) => setV((p) => ({ ...p, patrol_date: e.target.value }))}
            required
          />
        </div>
        <div>
          <label>チェックリスト種別</label>
          {isEdit ? (
            <input
              type="text"
              value={CHECKLIST_TYPES[v.checklist_type] ?? v.checklist_type}
              disabled
              style={{ width: 140 }}
            />
          ) : (
            <select
              value={v.checklist_type}
              onChange={(e) => switchType(e.target.value)}
              style={{ width: 160 }}
            >
              {Object.entries(CHECKLIST_TYPES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label>巡視者（衛生管理者）氏名</label>
          <input
            type="text"
            value={v.inspector_name}
            onChange={(e) => setV((p) => ({ ...p, inspector_name: e.target.value }))}
          />
        </div>
      </div>

      <h3 style={{ color: "var(--teal-dark)", fontSize: 15 }}>
        チェックリスト（{CHECKLIST_TYPES[v.checklist_type] ?? ""}）
      </h3>
      {v.results.length === 0 ? (
        <p className="muted">
          チェックリスト項目がありません。一覧ページの「チェックリスト項目の設定」で登録してください。
        </p>
      ) : (
        <table className="list" style={{ marginBottom: 14 }}>
          <thead>
            <tr>
              <th>点検項目</th>
              <th style={{ width: 130 }}>判定</th>
              <th style={{ width: "30%" }}>メモ</th>
            </tr>
          </thead>
          <tbody>
            {v.results.map((r, i) => (
              <tr key={i}>
                <td>{r.item}</td>
                <td>
                  <select
                    value={r.result}
                    onChange={(e) =>
                      setResult(i, { result: e.target.value as ChecklistResult["result"] })
                    }
                  >
                    {Object.entries(RESULT_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="text"
                    value={r.note}
                    onChange={(e) => setResult(i, { note: e.target.value })}
                    placeholder="要改善の内容など"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="form-row">
        <label>特記事項・改善指示</label>
        <textarea
          value={v.summary}
          onChange={(e) => setV((p) => ({ ...p, summary: e.target.value }))}
          style={{ minHeight: 80 }}
        />
      </div>

      {error && <p className="error-message">{error}</p>}
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "保存中…" : "保存する"}
        </button>
        <button type="button" className="btn secondary" onClick={() => router.push(backHref)}>
          キャンセル
        </button>
      </div>
    </form>
  );
}
