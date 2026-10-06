"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { currentUserId } from "@/lib/session";

export type MeetRoom = {
  enabled: boolean;
  meeting_uri: string | null;
  meeting_code: string | null;
  space_name: string | null;
  note: string | null;
};

const MEET_URL = /^https:\/\/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#].*)?$/;

// 面談ルームの設定(officeのみ)。Google Meet API で作成するか、既存の Meet リンクを手入力する
export default function MeetRoomSettings({
  companyId,
  room,
  apiConfigured,
}: {
  companyId: string;
  room: MeetRoom | null;
  apiConfigured: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState(room?.note ?? "");
  const [manualUrl, setManualUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (fn: () => Promise<string | null>, done: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const err = await fn();
    if (err) setError(err);
    else {
      setMessage(done);
      router.refresh();
    }
    setBusy(false);
  };

  const createViaApi = () => {
    if (room?.meeting_uri && !confirm("ルームを作り直すとリンクが変わります。よろしいですか？")) return;
    run(async () => {
      const res = await fetch(`/api/meet/${companyId}`, { method: "POST" });
      if (res.ok) return null;
      const json = await res.json().catch(() => ({}));
      return `作成できませんでした: ${json.error ?? res.status}`;
    }, "面談ルームを作成しました。");
  };

  const saveManual = (e: FormEvent) => {
    e.preventDefault();
    const m = manualUrl.trim().match(MEET_URL);
    if (!m) {
      setError("https://meet.google.com/xxx-xxxx-xxx の形式で入力してください。");
      return;
    }
    run(async () => {
      const supabase = createClient();
      const { error } = await supabase.from("hm_meet_rooms").upsert(
        {
          company_id: companyId,
          enabled: true,
          meeting_uri: `https://meet.google.com/${m[1]}`,
          meeting_code: m[1],
          space_name: null,
          created_by: await currentUserId(supabase),
        },
        { onConflict: "company_id" }
      );
      setManualUrl("");
      if (!error) {
        await supabase.rpc("hm_log_access", {
          p_action: "meet_room_create",
          p_target_table: "hm_meet_rooms",
          p_target_id: companyId,
          p_detail: { meeting_code: m[1], manual: true },
        });
      }
      return error ? `保存できませんでした: ${error.message}` : null;
    }, "リンクを登録しました。");
  };

  const update = (patch: Partial<MeetRoom>, done: string) =>
    run(async () => {
      const supabase = createClient();
      const { error } = await supabase
        .from("hm_meet_rooms")
        .update(patch)
        .eq("company_id", companyId);
      if (!error) {
        await supabase.rpc("hm_log_access", {
          p_action: "meet_room_update",
          p_target_table: "hm_meet_rooms",
          p_target_id: companyId,
          p_detail: patch,
        });
      }
      return error ? `保存できませんでした: ${error.message}` : null;
    }, done);

  return (
    <div className="card">
      <h2>ルームの設定（産業医事務所のみ）</h2>

      {room?.meeting_uri ? (
        <>
          <p>
            リンク: <code>{room.meeting_uri}</code>{" "}
            {room.space_name ? (
              <span className="badge">Meet API で作成・在室表示あり</span>
            ) : (
              <span className="badge orange">手入力・在室表示なし</span>
            )}
          </p>
          <label className="checkbox-row" style={{ marginBottom: 14 }}>
            <input
              type="checkbox"
              checked={room.enabled}
              disabled={busy}
              onChange={(e) =>
                update(
                  { enabled: e.target.checked },
                  e.target.checked ? "企業側に表示しました。" : "企業側に表示しないようにしました。"
                )
              }
            />
            この企業で面談ルームを使う（オフにすると企業側のメニューから消えます）
          </label>
          <div className="form-row">
            <label>企業向けの案内文（任意）</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ minHeight: 60 }}
              placeholder="例: 毎月第2火曜 14:00〜15:00 は産業医が在室しています。それ以外の時間はご連絡のうえご入室ください。"
            />
          </div>
          <button
            className="btn secondary"
            disabled={busy}
            onClick={() => update({ note: note.trim() || null }, "案内文を保存しました。")}
          >
            案内文を保存
          </button>
        </>
      ) : (
        <p className="muted">この企業の面談ルームはまだありません。</p>
      )}

      <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "18px 0" }} />

      {apiConfigured ? (
        <p>
          <button className="btn" disabled={busy} onClick={createViaApi}>
            {room?.meeting_uri ? "Google Meet でルームを作り直す" : "Google Meet で面談ルームを作成"}
          </button>
          <span className="muted" style={{ marginLeft: 10 }}>
            主催者は産業医アカウント。入室中の人と開催履歴が表示されます。
          </span>
        </p>
      ) : (
        <p className="muted">
          Google Meet API が未設定のため、自動作成はできません（README の「産業医面談ルーム」参照）。
          下の欄に、Google カレンダー等で作った Meet のリンクを登録して使うこともできます。
        </p>
      )}

      <form onSubmit={saveManual} style={{ marginTop: 10 }}>
        <div className="form-row">
          <label>既存の Meet リンクを登録する（手入力）</label>
          <input
            type="text"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            placeholder="https://meet.google.com/abc-defg-hij"
          />
        </div>
        <button className="btn secondary" type="submit" disabled={busy || !manualUrl.trim()}>
          このリンクを登録
        </button>
      </form>

      {error && <p className="error-message">{error}</p>}
      {message && <p style={{ color: "var(--teal-dark)", fontSize: 13 }}>{message}</p>}
    </div>
  );
}
