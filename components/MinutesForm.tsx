"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export type MinutesInput = {
  id?: string;
  company_id: string;
  meeting_date: string;
  title: string;
  attendees: string;
  physician_attended: boolean;
  agenda: string;
  decisions: string;
  next_meeting_date: string;
  next_meeting_note: string;
  published_to_employees: boolean;
};

// 定例議題テンプレート
const AGENDA_TEMPLATE = `1. 前回議事録の確認
2. 労働災害・ヒヤリハットの報告
3. 長時間労働の状況
4. 健康診断・ストレスチェックの実施状況
5. 職場巡視の報告
6. 産業医からの助言
7. その他`;

export default function MinutesForm({
  initial,
  backHref,
}: {
  initial: MinutesInput;
  backHref: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<MinutesInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof MinutesInput>(k: K, val: MinutesInput[K]) =>
    setV((p) => ({ ...p, [k]: val }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();

    const payload = {
      company_id: v.company_id,
      meeting_date: v.meeting_date,
      title: v.title || "安全衛生委員会",
      attendees: v.attendees || null,
      physician_attended: v.physician_attended,
      agenda: v.agenda || null,
      decisions: v.decisions || null,
      next_meeting_date: v.next_meeting_date || null,
      next_meeting_note: v.next_meeting_note || null,
      published_to_employees: v.published_to_employees,
    };

    let id = v.id;
    if (id) {
      const { error } = await supabase.from("hm_minutes").update(payload).eq("id", id);
      if (error) {
        setError(`保存に失敗しました: ${error.message}`);
        setBusy(false);
        return;
      }
      await supabase.rpc("hm_log_access", {
        p_action: "update",
        p_target_table: "hm_minutes",
        p_target_id: id,
      });
    } else {
      const { data: user } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("hm_minutes")
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
        p_target_table: "hm_minutes",
        p_target_id: id,
      });
    }
    router.replace(`/minutes/${id}`);
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="form-row">
        <label>開催日 *</label>
        <input
          type="date"
          value={v.meeting_date}
          onChange={(e) => set("meeting_date", e.target.value)}
          required
        />
      </div>
      <div className="form-row">
        <label>件名</label>
        <input
          type="text"
          value={v.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="安全衛生委員会"
        />
      </div>
      <div className="form-row">
        <label>出席者</label>
        <textarea
          value={v.attendees}
          onChange={(e) => set("attendees", e.target.value)}
          placeholder="委員長: ○○、衛生管理者: ○○、産業医: ○○ ほか"
          style={{ minHeight: 70 }}
        />
      </div>
      <div className="form-row checkbox-row">
        <input
          id="physician"
          type="checkbox"
          checked={v.physician_attended}
          onChange={(e) => set("physician_attended", e.target.checked)}
        />
        <label htmlFor="physician" style={{ margin: 0 }}>
          産業医が出席した
        </label>
      </div>
      <div className="form-row">
        <label>
          審議事項{" "}
          {!v.agenda && (
            <button
              type="button"
              className="btn secondary"
              style={{ padding: "2px 10px", fontSize: 12, marginLeft: 8 }}
              onClick={() => set("agenda", AGENDA_TEMPLATE)}
            >
              定例議題テンプレートを挿入
            </button>
          )}
        </label>
        <textarea value={v.agenda} onChange={(e) => set("agenda", e.target.value)} />
      </div>
      <div className="form-row">
        <label>決定事項</label>
        <textarea value={v.decisions} onChange={(e) => set("decisions", e.target.value)} />
      </div>
      <div className="form-row">
        <label>次回開催予定日</label>
        <input
          type="date"
          value={v.next_meeting_date}
          onChange={(e) => set("next_meeting_date", e.target.value)}
        />
      </div>
      <div className="form-row">
        <label>次回予定メモ</label>
        <input
          type="text"
          value={v.next_meeting_note}
          onChange={(e) => set("next_meeting_note", e.target.value)}
          placeholder="次回の主な議題など"
        />
      </div>
      <div className="form-row checkbox-row">
        <input
          id="publish"
          type="checkbox"
          checked={v.published_to_employees}
          onChange={(e) => set("published_to_employees", e.target.checked)}
        />
        <label htmlFor="publish" style={{ margin: 0 }}>
          従業員に公開する
        </label>
      </div>

      {error && <p className="error-message">{error}</p>}

      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "保存中…" : "保存する"}
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={() => router.push(backHref)}
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
