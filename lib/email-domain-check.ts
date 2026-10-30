import { promises as dns } from "dns";
import { emailDomain, suggestEmailDomain } from "@/lib/email-domain";

// サーバー側で、メールアドレスのドメインがメールを受け取れるか(MXまたはAレコードがあるか)を確認する。
// 存在しないドメイン(入力ミス)に確認メール・招待メールを送ると、送信サービスで再送(Delivery Delayed)を
// 繰り返した末に失敗し、本人は登録できたつもりのまま放置されるため、登録の時点で止める。
// DNS の一時的な障害やタイムアウトのときは送信を妨げない(確認できないときは通す)。

export type EmailDomainCheck = { ok: true } | { ok: false; message: string };

const TIMEOUT_MS = 3000;

function withTimeout<T>(p: Promise<T>): Promise<T | "timeout"> {
  return Promise.race([p, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), TIMEOUT_MS))]);
}

// 「ドメインが存在しない/レコードが無い」ことが確定したときだけ false
async function hasRecord(lookup: () => Promise<unknown[]>): Promise<boolean | null> {
  try {
    const r = await withTimeout(lookup());
    if (r === "timeout") return null;
    return r.length > 0;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "NXDOMAIN") return false;
    return null; // 一時的な失敗(判定できない)
  }
}

export async function checkEmailDomain(email: string): Promise<EmailDomainCheck> {
  const domain = emailDomain(email);
  if (!domain || !domain.includes(".")) {
    return { ok: false, message: "メールアドレスの形式が正しくありません。入力内容をご確認ください。" };
  }
  const mx = await hasRecord(() => dns.resolveMx(domain));
  if (mx !== false) return { ok: true }; // MXあり、または判定できない(通す)
  // MXが無くてもAレコードがあれば受け取れる場合がある
  const a = await hasRecord(() => dns.resolve4(domain));
  if (a !== false) return { ok: true };

  const hint = suggestEmailDomain(email);
  return {
    ok: false,
    message:
      `メールアドレスのドメイン「${domain}」は存在しないため、メールを届けられません。` +
      (hint ? `「${hint}」の入力ミスではありませんか？` : "") +
      "入力内容をご確認ください。",
  };
}
