"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const m = error.message || "";
      if (m.includes("Invalid login credentials")) {
        setError("メールアドレスまたはパスワードが正しくありません。");
      } else if (m.includes("Email not confirmed")) {
        setError(
          "メールアドレスが未確認の状態です。Supabaseの Authentication > Users で該当ユーザーのメニューから確認済みにしてください。"
        );
      } else if (m.includes("fetch") || m.includes("Failed") || m.includes("network")) {
        setError(
          "サーバーに接続できませんでした。Vercelの環境変数(NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)の設定を確認し、再デプロイしてください。"
        );
      } else {
        setError(`ログインに失敗しました（詳細: ${m}）`);
      }
      setBusy(false);
      return;
    }
    router.replace("/");
    router.refresh();
  };

  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 60 }}>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="mestate うえまつ産業医事務所"
          style={{ height: 90, width: "auto", display: "block", margin: "0 auto 10px" }}
        />
        <div className="brand" style={{ fontSize: 22 }}>
          健康管理<span style={{ color: "var(--orange)" }}>Web</span>
        </div>
      </div>

      {params.get("timeout") && (
        <div className="notice">
          一定時間操作がなかったため、自動的にログアウトしました。再度ログインしてください。
        </div>
      )}

      <div className="card">
        <h2>ログイン</h2>
        <form onSubmit={onSubmit}>
          <div className="form-row">
            <label htmlFor="email">メールアドレス</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </div>
          <div className="form-row">
            <label htmlFor="password">パスワード</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          {error && <p className="error-message">{error}</p>}
          <button className="btn" type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy ? "ログイン中…" : "ログイン"}
          </button>
        </form>
        <p className="muted" style={{ marginTop: 14 }}>
          ストレスチェックWebと同じアカウントでログインできます。アカウントをお持ちでない方は産業医事務所にお問い合わせください。
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
