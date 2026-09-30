"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { WORK_JUDGMENTS } from "@/lib/interviews";
import { currentUserId, logAccessInBackground } from "@/lib/session";

export type OpinionInitial = {
  id?: string;
  interview_date: string;
  work_judgment: string;
  opinion: string;
  issued_date: string;
  physician_name: string;
  published: boolean;
};

// 事業者向け意見書の作成(officeのみ)。企業側に公開されるのはこの内容だけ。
export default function OpinionPanel({
  interviewId,
  companyId,
  initial,
}: {
  interviewId: string;
  companyId: string;
  initial: OpinionInitial;
}) {
  const router = useRouter();
  const [v, setV] = useState<OpinionInitial>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const supabase = createClient();
    const userId = await currentUserId(supabase);

    const payload = {
      interview_id: interviewId,
      company_id: companyId,
      interview_date: v.interview_date || null,
      work_judgment: v.work_judgment || null,
      opinion: v.opinion || null,
      physician_name: v.physician_name.trim() || null,
      // 発行日は保存日を自動記録
      issued_date: new Date().toISOString().slice(0, 10),
      published: v.published,
      created_by: userId,
    };

    // 保存と同時にIDを受け取り、画面の再読み込みなしで「意見書を表示」を出せるようにする
    const { data, error } = await supabase
      .from("hm_interview_opinions")
      .upsert(payload, { onConflict: "interview_id" })
      .select("id")
      .single();
    if (error) {
      setError(`保存に失敗しました: ${error.message}`);
    } else {
      logAccessInBackground(supabase, {
        p_action: "save_opinion",
        p_target_table: "hm_interview_opinions",
        p_target_id: interviewId,
        p_detail: { published: v.published },
      });
      if (data?.id) setV((p) => ({ ...p, id: data.id }));
      setSaved(true);
      // 事業者側の表示に関わる公開状態が変わったときだけ、裏でページのデータを更新する
      if (v.published !== initial.published) router.refresh();
    }
    setBusy(false);
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="form-row">
        <label>面談実施日（意見書に記載）</label>
        <input
          type="date"
          value={v.interview_date}
          onChange={(e) => setV((p) => ({ ...p, interview_date: e.target.value }))}
        />
      </div>
      <div className="form-row">
        <label>就業区分の判定</label>
        <select
          value={v.work_judgment}
          onChange={(e) => setV((p) => ({ ...p, work_judgment: e.target.value }))}
        >
          <option value="">（未選択）</option>
          {Object.entries(WORK_JUDGMENTS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label>就業上の措置に関する意見（企業に公開されます）</label>
        <textarea
          value={v.opinion}
          onChange={(e) => setV((p) => ({ ...p, opinion: e.target.value }))}
          placeholder="時間外労働の制限、業務内容の配慮 など。個人の詳細な健康情報は記載しないでください。"
        />
      </div>
      <div className="form-row">
        <label>産業医名（敬称は付けません）</label>
        <input
          type="text"
          value={v.physician_name}
          onChange={(e) => setV((p) => ({ ...p, physician_name: e.target.value }))}
          placeholder="上松弘典"
          style={{ width: 200 }}
        />
        <p className="muted" style={{ margin: "4px 0 0" }}>
          発行日は保存した日が自動で記録されます。
        </p>
      </div>
      <div className="form-row checkbox-row">
        <input
          id="publish-opinion"
          type="checkbox"
          checked={v.published}
          onChange={(e) => setV((p) => ({ ...p, published: e.target.checked }))}
        />
        <label htmlFor="publish-opinion" style={{ margin: 0 }}>
          企業側に公開する
        </label>
      </div>
      {error && <p className="error-message">{error}</p>}
      {saved && <p style={{ color: "var(--teal-dark)", fontSize: 13 }}>保存しました。</p>}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "保存中…" : "意見書を保存"}
        </button>
        {v.id && (
          <Link className="btn secondary" href={`/interview-sheet/${interviewId}`}>
            意見書を表示（印刷/PDF）
          </Link>
        )}
      </div>
    </form>
  );
}
