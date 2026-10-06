"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { ensureSession } from "@/lib/session";

type Participant = { name: string; since: string | null };
type Conference = { start: string; end: string | null };
type Status = {
  supported?: boolean;
  participants?: Participant[];
  history?: Conference[];
  error?: string;
};
export type MeetEntry = { user_name: string | null; role: string; entered_at: string };

const POLL_MS = 30_000;

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fmtTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function minutesBetween(a: string, b: string) {
  return Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
}

// 産業医面談ルーム(Google Meet 常設ルーム)。在室状況を30秒ごとに更新し、
// 「面談ルームに入る」で入室を記録してから Meet を新しいタブで開く
export default function MeetRoomPanel({
  companyId,
  note,
  entries,
  viewer,
}: {
  companyId: string;
  note: string | null;
  entries: MeetEntry[];
  viewer: "office" | "company";
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/meet/${companyId}`, { cache: "no-store" });
      if (res.ok) setStatus(await res.json());
    } catch {
      /* 通信できないときは前回の表示のまま */
    }
  }, [companyId]);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const enter = async () => {
    setError(null);
    setBusy(true);
    // ポップアップブロックを避けるため、クリック直後に空のタブを開いておく
    const win = window.open("about:blank", "_blank");
    const supabase = createClient();
    if (!(await ensureSession(supabase))) {
      win?.close();
      setError("ログインの有効期限が切れました。もう一度ログインしてください。");
      setBusy(false);
      return;
    }
    const { data, error } = await supabase.rpc("hm_meet_enter", { p_company_id: companyId });
    if (error || !data) {
      win?.close();
      setError(`入室できませんでした: ${error?.message ?? "ルームが見つかりません"}`);
    } else if (win) {
      win.opener = null;
      win.location.href = data as string;
    } else {
      window.location.href = data as string;
    }
    setBusy(false);
    setTimeout(load, 15_000);
  };

  const participants = status?.participants ?? [];
  const live = participants.length > 0;
  const other = viewer === "office" ? "事業者担当者" : "産業医";

  return (
    <>
      <div className="card" style={{ borderColor: live ? "var(--teal)" : undefined }}>
        <h2>面談ルーム</h2>

        {status?.supported === false ? (
          <p className="muted">このルームでは在室状況を表示できません（リンクを手入力で登録したため）。</p>
        ) : status === null ? (
          <p className="muted">在室状況を確認しています…</p>
        ) : status.error ? (
          <p className="muted">在室状況を取得できませんでした。入室は通常どおり行えます。</p>
        ) : live ? (
          <div style={{ marginBottom: 12 }}>
            <span className="badge">● 入室中 {participants.length}名</span>
            <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
              {participants.map((p, i) => (
                <li key={i}>
                  {p.name}
                  {p.since && <span className="muted">（{fmtTime(p.since)}〜）</span>}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted">現在、ルームには誰もいません。</p>
        )}

        <button className="btn" onClick={enter} disabled={busy} style={{ fontSize: 16, padding: "12px 28px" }}>
          {busy ? "接続中…" : "🎥 面談ルームに入る"}
        </button>
        <p className="muted" style={{ marginTop: 8 }}>
          Google Meet が新しいタブで開きます。この事業所専用のルームで、毎回同じリンクを使います。
          {viewer === "company" &&
            "「参加をリクエスト」と表示された場合は、そのままお待ちください。産業医が承認すると入室できます。"}
          {viewer === "office" && "企業側の方が参加をリクエストしたら、Meet の画面で承認してください。"}
        </p>
        {note && (
          <div className="notice" style={{ marginTop: 10, marginBottom: 0, whiteSpace: "pre-wrap" }}>
            {note}
          </div>
        )}
        {error && <p className="error-message">{error}</p>}
        {!live && status?.supported && !status.error && (
          <p className="muted" style={{ marginTop: 8 }}>
            {other}が入室すると、この画面に表示されます（30秒ごとに自動更新）。
          </p>
        )}
      </div>

      {(status?.history?.length ?? 0) > 0 && (
        <div className="card">
          <h2>開催履歴（Google Meet）</h2>
          <table className="list">
            <thead>
              <tr>
                <th>開始</th>
                <th>終了</th>
                <th>時間</th>
              </tr>
            </thead>
            <tbody>
              {status!.history!.map((c, i) => (
                <tr key={i}>
                  <td>{fmtDateTime(c.start)}</td>
                  <td>{c.end ? fmtTime(c.end) : <span className="badge">開催中</span>}</td>
                  <td>{c.end ? `${minutesBetween(c.start, c.end)}分` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>入室記録（健康管理Webから）</h2>
        {entries.length > 0 ? (
          <table className="list">
            <thead>
              <tr>
                <th>日時</th>
                <th>お名前</th>
                <th>区分</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i}>
                  <td>{fmtDateTime(e.entered_at)}</td>
                  <td>{e.user_name ?? "—"}</td>
                  <td>{e.role === "office" ? "産業医事務所" : "事業者担当者"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">まだ入室記録はありません。</p>
        )}
      </div>
    </>
  );
}
