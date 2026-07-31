"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export type PatrolInput = {
  id?: string;
  company_id: string;
  patrol_date: string;
  areas: string;
  findings: string;
  advice: string;
  note: string;
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
      areas: v.areas.trim() || null,
      findings: v.findings.trim() || null,
      advice: v.advice.trim() || null,
      note: v.note.trim() || null,
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
        <label>巡視場所</label>
        <textarea
          value={v.areas}
          onChange={(e) => set("areas", e.target.value)}
          placeholder="例: 本社2F 事務室、倉庫、休憩室"
          style={{ minHeight: 60 }}
        />
      </div>
      <div className="form-row">
        <label>指摘事項・所見</label>
        <textarea
          value={v.findings}
          onChange={(e) => set("findings", e.target.value)}
          placeholder="例: 通路に荷物が仮置きされ動線を塞いでいる、休憩室の換気不良 など"
        />
      </div>
      <div className="form-row">
        <label>指導・助言</label>
        <textarea
          value={v.advice}
          onChange={(e) => set("advice", e.target.value)}
        />
      </div>
      <div className="form-row">
        <label>改善状況・備考</label>
        <textarea
          value={v.note}
          onChange={(e) => set("note", e.target.value)}
          style={{ minHeight: 60 }}
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
