import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { checkMessage, isCode, maskEmail, normalizeCode } from "@/lib/secondStep";
import { checkCode, currentLogin, issueAndSend, serverReady, setDeviceCookie, setHintCookie, stepState, tryDevice } from "@/lib/secondStepServer";

export const dynamic = "force-dynamic";

const APP_NAME = "健康管理Web";
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

// 二段階認証(メールの確認コード)。有効・無効の切り替えは、ストレスチェックWebの事務所の画面で行う(両方のアプリに効く)。
//   GET                                       このアプリの準備状況(ストレスチェックWebの設定画面から確かめるため。秘密は返さない)
//   POST { action: "send" }                   確認コードを送る(不要な方・確認済みの方は done を返す)
//        { action: "verify", code, remember } 確認コードを照合する
export async function GET() {
  const admin = adminClient();
  const settings = admin ? await admin.rpc("second_step_settings") : null;
  return NextResponse.json({ ready: serverReady(), applied: Boolean(settings && !settings.error) });
}

export async function POST(req: Request) {
  let body: { action?: unknown; code?: unknown; remember?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "リクエスト形式が不正です");
  }
  const { supabase, user, sessionId } = await currentLogin();
  if (!user) return fail(401, "ログインの有効期限が切れました。もう一度ログインしてください。");
  if (!sessionId) return fail(401, "ログインの情報を確認できませんでした。いったんログアウトして、もう一度ログインしてください。");
  const action = String(body.action ?? "");

  if (action === "send") {
    const s = await stepState(supabase);
    const done = () => {
      const res = NextResponse.json({ done: true });
      setHintCookie(res, sessionId);
      return res;
    };
    if (!s.required || s.verified) return done();
    if (await tryDevice(user.id, sessionId)) return done();
    const r = await issueAndSend(user, APP_NAME);
    if (r.ok) return NextResponse.json({ sent: true, to: maskEmail(user.email), wait: r.done ? 0 : r.wait });
    // 送ったばかり(画面の再読み込みなど)は、失敗ではなく「送信済み」として扱う
    if (r.status === 429 && (r.wait ?? 0) <= 60) return NextResponse.json({ sent: true, already: true, to: maskEmail(user.email), wait: r.wait ?? 60 });
    return fail(r.status, r.error, { wait: r.wait });
  }

  if (action === "verify") {
    const code = normalizeCode(String(body.code ?? ""));
    if (!isCode(code)) return fail(400, "確認コードは、メールに書かれた6けたの数字です。");
    const label = (req.headers.get("user-agent") ?? "").slice(0, 200);
    const { result, device } = await checkCode(user.id, sessionId, code, body.remember === true, label);
    if (result !== "ok") return fail(result === "error" ? 503 : 400, checkMessage(result), { result });
    const res = NextResponse.json({ ok: true });
    setHintCookie(res, sessionId);
    if (device) setDeviceCookie(res, device);
    return res;
  }
  return fail(400, "操作の指定が不正です");
}
