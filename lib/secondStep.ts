// 二段階認証(メールの確認コード + この端末を30日間覚える)で、画面とサーバーの両方から使うもの。
// ミドルウェア(Edge)からも読み込むので、Node専用の機能は使わない

// このログインは確認済み(または確認が不要)と分かっていることの目印。値はログイン(セッション)のID。
// 画面の行き先を決めるためだけに使う(権限の判定はデータベースが行うので、書き換えても何も見えるようにはならない)
export const SS_HINT_COOKIE = "ss_ok";
// 「この端末を30日間覚える」の印(サーバーだけが読める。中身は乱数で、データベースには照合用の値だけを持つ)
export const SS_DEVICE_COOKIE = "ss_dev";
export const SS_DEVICE_DAYS = 30;
export const SS_GATE_PATH = "/api/second-step/gate";
export const SS_VERIFY_PATH = "/verify";

// アクセストークン(JWT)から、ログイン(セッション)のIDを取り出す。
// トークンが本物かどうかは Supabase Auth への確認(getUser)で済ませてから使う
export function sessionIdOf(accessToken: string | null | undefined): string | null {
  const part = (accessToken ?? "").split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    const sid = typeof json.session_id === "string" ? json.session_id : "";
    return /^[0-9a-fA-F-]{36}$/.test(sid) ? sid.toLowerCase() : null;
  } catch {
    return null;
  }
}

// 入力された確認コードをそろえる(全角数字・空白・ハイフンが混ざっていてもよい)
export function normalizeCode(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\s\-ー－‐]/g, "")
    .trim();
}
export const isCode = (code: string): boolean => /^\d{6}$/.test(code);

// 送り先のメールアドレスを、一部を伏せて表示する(例: ya***@example.co.jp)
export function maskEmail(email: string | null | undefined): string {
  const [local, domain] = (email ?? "").split("@");
  if (!local || !domain) return "登録のメールアドレス";
  const head = local.slice(0, Math.min(2, Math.max(1, local.length - 1)));
  return `${head}***@${domain}`;
}

// ログイン後の戻り先として安全なパスか(外部サイトへ飛ばさない)
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (next.startsWith(SS_VERIFY_PATH) || next.startsWith("/api/")) return fallback;
  return next;
}

// 確認コードの照合結果を、画面に出す文に変える
export function checkMessage(result: string): string {
  switch (result) {
    case "wrong":
      return "確認コードが違います。メールに書かれた6けたの数字を、もう一度入力してください。";
    case "locked":
      return "入力を5回まちがえたため、このコードは使えなくなりました。「コードを送り直す」を押して、新しいコードを入力してください。";
    case "expired":
      return "確認コードの有効期限(10分)が切れました。「コードを送り直す」を押してください。";
    case "none":
      return "確認コードが見つかりません。「コードを送り直す」を押してください。";
    default:
      return "確認できませんでした。もう一度お試しください。";
  }
}
