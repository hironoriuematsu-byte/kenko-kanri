"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export type PatrolInput = {
  id?: string;
  company_id: string;
  patrol_date: string;
  findings: string; // 指摘事項等(巡視場所・所見・指導・改善状況をまとめて記載)
};

// 産業医巡視記録の作成・編集(officeのみ)
export default function PatrolForm({
  initial,
  physicianName,
  backHref,
}: {
  initial: PatrolInput;
  physicianName: string;
  backHref: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<PatrolInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof PatrolInput>(k: K, val: PatrolInput[K]) =>
    setV((p) => ({ ...p, [k]: val }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();

    const payload = {
      company_id: v.company_id,
      patrol_date: v.patrol_date,
      areas: null,
      findings: v.findings.trim() || null,
      advice: null,
      note: null,
      physician_name: physicianName,
    };

    let id = v.id;
    if (id) {
      const { error } = await supabase.from("hm_patrols").update(payload).eq("id", id);
      if (error) {
        setError(`保存に失敗しました: ${error.message}`);
        setBusy(false);
        return;
      }
      await supabase.rpc("hm_log_access", {
        p_action: "update",
        p_target_table: "hm_patrols",
        p_target_id: id,
      });
    } else {
      const { data: user } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("hm_patrols")
        .insert({ ...payload, created_by: user.user?.id })
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
        p_target_table: "hm_patrols",
        p_target_id: id,
      });
    }
    router.replace(`/patrols/${id}`);
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="form-row">
        <label>巡視日 *</label>
        <input
          type="date"
          value={v.patrol_date}
          onChange={(e) => set("patrol_date", e.target.value)}
          required
        />
      </div>
      <div className="form-row">
        <label>指摘事項等</label>
        <textarea
          value={v.findings}
          onChange={(e) => set("findings", e.target.value)}
          placeholder={
            "巡視場所、指摘事項・所見、指導・助言、改善状況などをまとめて記載してください。\n例:\n本社2F事務室・倉庫・休憩室を巡視。通路に荷物が仮置きされ動線を塞いでいるため整理を指導。休憩室の換気不良あり、換気扇の点検を依頼。前回指摘の配線カバーは改善済み。"
          }
          style={{ minHeight: 180 }}
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
