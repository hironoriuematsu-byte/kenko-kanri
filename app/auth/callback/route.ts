import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// メール内リンク(Web申込の担当者アカウントの確認など)を開いたときの中継ページ。
// 会社のメールセキュリティがリンクを先に開いて1回限りのトークンを使ってしまわないよう、
// 本人がボタンを押したとき(POST)に初めてトークンを使う(ストレスチェックWebと同じ方式)

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

const OTP_TYPES: EmailOtpType[] = ["invite", "signup", "recovery", "email_change", "magiclink", "email"];

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function confirmPage(tokenHash: string, type: string, next: string): Response {
  const signup = type === "signup";
  const heading = signup ? "担当者アカウントの有効化" : "続行の確認";
  const button = signup ? "アカウントを有効にして担当者の画面へ" : "続ける";
  const lead = signup
    ? "会社のご登録ありがとうございます。下のボタンを押すと、健康管理Webの担当者の画面が開きます。健診結果の件数を入力してお支払いいただくと、健診結果を送れるようになります。"
    : "うえまつ産業医事務所 健康管理Web です。下のボタンを押して次へ進んでください。";
  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${heading} | うえまつ産業医事務所 健康管理Web</title>
<style>
  body { margin: 0; background: #F4F7F7; font-family: 'Meiryo','Hiragino Sans','Yu Gothic',sans-serif; color: #22333B; }
  .wrap { max-width: 440px; margin: 48px auto; padding: 0 16px; }
  .card { background: #fff; border: 1px solid #DDE5E4; border-radius: 14px; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  p { font-size: 14px; line-height: 1.8; margin: 0 0 16px; }
  button { display: inline-block; width: 100%; background: #0F9B8E; color: #fff; font-weight: 700; font-size: 15px; border: 0; border-radius: 10px; padding: 14px 20px; cursor: pointer; }
  .note { font-size: 12px; color: #7A8886; margin: 14px 0 0; }
</style>
</head>
<body>
<div class="wrap"><div class="card">
<h1>${heading}</h1>
<p>${lead}</p>
<form method="post" action="/auth/callback">
<input type="hidden" name="token_hash" value="${escapeHtml(tokenHash)}" />
<input type="hidden" name="type" value="${escapeHtml(type)}" />
<input type="hidden" name="next" value="${escapeHtml(next)}" />
<button type="submit">${button}</button>
</form>
<p class="note">このリンクはメールが届いてから1時間有効です。期限が切れた場合は support@mestate.jp までご連絡ください。</p>
</div></div>
</body>
</html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeNext(searchParams.get("next"));
  if (tokenHash && type && (OTP_TYPES as string[]).includes(type)) return confirmPage(tokenHash, type, next);
  return NextResponse.redirect(`${origin}${next}`);
}

export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  const form = await request.formData();
  const tokenHash = String(form.get("token_hash") ?? "");
  const type = String(form.get("type") ?? "");
  const next = safeNext(form.get("next") ? String(form.get("next")) : null);
  if (!tokenHash || !(OTP_TYPES as string[]).includes(type)) {
    return NextResponse.redirect(`${origin}/login?error=link`, 303);
  }
  const supabase = createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
  if (error) return NextResponse.redirect(`${origin}/login?error=link`, 303);
  return NextResponse.redirect(`${origin}${next}`, 303);
}
