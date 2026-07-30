"use client";

import { useEffect, useState } from "react";

// 設定診断ページ(開発用)。/login/diag で開く。
// NEXT_PUBLIC_ の値はもともとブラウザに公開される情報のため表示しても安全。
export default function DiagPage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const [health, setHealth] = useState<string>("確認中…");

  const keyType = !key
    ? "未設定"
    : key.startsWith("sb_publishable_")
      ? "OK（publishableキー）"
      : key.startsWith("eyJ")
        ? "OK（anonキー）"
        : key.startsWith("sb_secret_")
          ? "NG！ secretキーが設定されています。publishableキーに差し替えてください"
          : "不明な形式です。コピーミスの可能性があります";

  useEffect(() => {
    if (!url || !key) {
      setHealth("URLまたはキーが未設定のため確認できません");
      return;
    }
    fetch(`${url.replace(/\/+$/, "")}/auth/v1/health`, {
      headers: { apikey: key },
    })
      .then((r) => {
        if (r.ok) setHealth("OK（Supabaseに接続できました）");
        else if (r.status === 401 || r.status === 403)
          setHealth(`NG（接続はできましたがキーが拒否されました: HTTP ${r.status}）`);
        else setHealth(`NG（HTTP ${r.status}）`);
      })
      .catch(() => setHealth("NG（接続できません。URLが間違っている可能性があります）"));
  }, [url, key]);

  const rows: [string, string][] = [
    ["接続先URL", url || "未設定！ Vercelの環境変数を確認してください"],
    ["URLのプロジェクトID", url ? (url.match(/https:\/\/([^.]+)\./)?.[1] ?? "解析不能") : "—"],
    ["キーの形式", keyType],
    ["キーの先頭", key ? key.slice(0, 18) + "…" : "—"],
    ["接続テスト", health],
  ];

  return (
    <div className="container" style={{ maxWidth: 640 }}>
      <div className="card">
        <h2>設定診断（開発用）</h2>
        <table className="list">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <th style={{ width: 180 }}>{k}</th>
                <td style={{ wordBreak: "break-all" }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ marginTop: 12 }}>
          「URLのプロジェクトID」が開発用Supabaseプロジェクト（kenko-kanri-dev）の
          Project IDと一致していること、接続テストがOKであることを確認してください。
        </p>
        <p>
          <a href="/login">← ログイン画面に戻る</a>
        </p>
      </div>
    </div>
  );
}
