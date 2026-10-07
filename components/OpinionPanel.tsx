"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { WORK_JUDGMENTS } from "@/lib/interviews";
import { currentUserId, logAccessInBackground } from "@/lib/session";
import VoiceInputButton, { appendText } from "@/components/VoiceInputButton";

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
// 入力が止まって数秒たつと自動で保存する。「企業側に公開し、面談を実施済にする」を付けて
// 保存(自動保存を含む)すると公開され、面談が実施済になる
const AUTOSAVE_DELAY_MS = 4000;
const LOG_INTERVAL_MS = 60 * 60 * 1000; // 保存のログは同じ面談で1時間に1行

// 同じ面談の保存ログを1時間に1行にする(ブラウザ側で最後に記録した時刻を覚えておく)
function shouldLog(interviewId: string): boolean {
  const key = `hm-log:save_opinion:${interviewId}`;
  try {
    const last = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < LOG_INTERVAL_MS) return false;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    /* ストレージが使えない環境では毎回記録する */
  }
  return true;
}

const same = (a: OpinionInitial, b: OpinionInitial) =>
  a.interview_date === b.interview_date &&
  a.work_judgment === b.work_judgment &&
  a.opinion === b.opinion &&
  a.physician_name === b.physician_name &&
  a.published === b.published;

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
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 最後にサーバーへ保存した内容(変わっていなければ自動保存しない)。
  // 意見書がまだ無い(id なし)ときは、何か入力されるまで保存しない
  const lastSaved = useRef<OpinionInitial | null>(initial.id ? initial : null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(
    async (auto: boolean) => {
      const current = v;
      if (auto) {
        if (lastSaved.current && same(lastSaved.current, current)) return; // 変わっていない
        if (!lastSaved.current && same(initial, current)) return; // 未作成で未入力
      }
      setBusy(true);
      setError(null);
      const supabase = createClient();
      const userId = await currentUserId(supabase);

      const payload = {
        interview_id: interviewId,
        company_id: companyId,
        interview_date: current.interview_date || null,
        work_judgment: current.work_judgment || null,
        opinion: current.opinion || null,
        physician_name: current.physician_name.trim() || null,
        // 発行日は保存日を自動記録
        issued_date: new Date().toISOString().slice(0, 10),
        published: current.published,
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
        setBusy(false);
        return;
      }
      if (shouldLog(interviewId)) {
        logAccessInBackground(supabase, {
          p_action: "save_opinion",
          p_target_table: "hm_interview_opinions",
          p_target_id: interviewId,
          p_detail: { published: current.published },
        });
      }
      if (data?.id) setV((p) => ({ ...p, id: data.id }));
      // 公開に切り替わったら面談を「実施済」にする(産業医面談は実施したら必ず意見書を公開するため)
      const wasPublished = lastSaved.current?.published ?? initial.published;
      let doneOk = true;
      if (current.published && !wasPublished) {
        const { error: doneErr } = await supabase.rpc("hm_mark_interview_done", {
          p_id: interviewId,
          p_conducted_date: current.interview_date || null,
        });
        if (doneErr) {
          doneOk = false;
          setError(
            /function|schema cache/i.test(doneErr.message)
              ? "意見書は保存しましたが、面談を実施済にできませんでした(SQL 0137 が未実行です。SQL Editor で実行してください)。"
              : `意見書は保存しましたが、面談を実施済にできませんでした: ${doneErr.message}`
          );
        }
      }
      lastSaved.current = current;
      const t = new Date();
      const hm = `${t.getHours()}:${String(t.getMinutes()).padStart(2, "0")}`;
      setStatus(
        (auto ? "自動保存しました" : "保存しました") +
          (current.published && !wasPublished && doneOk ? "。企業側に公開し、面談を実施済にしました" : "") +
          `（${hm}）`
      );
      // 公開状態(=実施済の表示)が変わったときは、裏でページのデータを更新する
      if (current.published !== wasPublished) router.refresh();
      setBusy(false);
    },
    [v, initial, interviewId, companyId, router]
  );

  // 入力が止まってしばらくしたら自動保存する
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(true), AUTOSAVE_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [v, save]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (timer.current) clearTimeout(timer.current);
    await save(false);
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
        <label>
          就業上の措置に関する意見（企業に公開されます）
          <VoiceInputButton onAppend={(t) => setV((p) => ({ ...p, opinion: appendText(p.opinion, t) }))} />
        </label>
        <textarea
          value={v.opinion}
          onChange={(e) => setV((p) => ({ ...p, opinion: e.target.value }))}
          onBlur={() => save(true)}
          placeholder="時間外労働の制限、業務内容の配慮 など。個人の詳細な健康情報は記載しないでください。入力が止まると自動で保存されます。"
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
          企業側に公開し、面談を実施済にする
        </label>
      </div>
      {error && <p className="error-message">{error}</p>}
      {status && <p style={{ color: "var(--teal-dark)", fontSize: 13 }}>{status}</p>}
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
