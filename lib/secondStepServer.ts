import { createHash, randomBytes, randomInt } from "node:crypto";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { mailConfigured, sendMail } from "@/lib/mail";
import { SS_DEVICE_COOKIE, SS_DEVICE_DAYS, SS_HINT_COOKIE, sessionIdOf } from "@/lib/secondStep";

export { stepState, stepBlocked, STEP_BLOCKED_MESSAGE, type StepState } from "@/lib/secondStepState";

// 二段階認証のサーバー側の処理。確認コード・覚えた端末の表には、service_role のクライアントだけが触れる

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
// データベースには、確認コードや端末の印そのものではなく、照合用の値だけを渡す
export const hashCode = (userId: string, code: string) => sha256(`code:${userId}:${code}`);
export const hashDevice = (token: string) => sha256(`device:${token}`);
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const newDeviceToken = () => randomBytes(32).toString("base64url");

// ログイン中の利用者と、そのログイン(セッション)のID
export async function currentLogin(): Promise<{ supabase: SupabaseClient; user: { id: string; email?: string } | null; sessionId: string | null }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, sessionId: null };
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return { supabase, user, sessionId: sessionIdOf(session?.access_token) };
}

const secure = process.env.NODE_ENV === "production";

type CookieJar = { cookies: { set: (name: string, value: string, options: Record<string, unknown>) => unknown } };
// このログインは確認済み(または確認不要)という目印を、返事に付ける(ブラウザを閉じるまで)
export function setHintCookie(res: CookieJar, sessionId: string) {
  res.cookies.set(SS_HINT_COOKIE, sessionId, { httpOnly: true, secure, sameSite: "lax", path: "/" });
}
// 「この端末を30日間覚える」の印を、返事に付ける
export function setDeviceCookie(res: CookieJar, token: string) {
  res.cookies.set(SS_DEVICE_COOKIE, token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: SS_DEVICE_DAYS * 86400 });
}
export const deviceToken = (): string | null => {
  const v = cookies().get(SS_DEVICE_COOKIE)?.value ?? "";
  return /^[A-Za-z0-9_-]{20,}$/.test(v) ? v : null;
};

// 覚えた端末からのログインなら、確認コードなしで確認済みにする
export async function tryDevice(userId: string, sessionId: string): Promise<boolean> {
  const token = deviceToken();
  const admin = adminClient();
  if (!token || !admin) return false;
  const { data, error } = await admin.rpc("second_step_device", { p_user: userId, p_session: sessionId, p_device_hash: hashDevice(token) });
  return !error && data === true;
}

// メールの準備ができているか(確認コードを送れるか)
export const mailReady = (): boolean => mailConfigured();
export const serverReady = (): boolean => Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) && mailReady();

// 確認コードをメールで送る。本文には、コードのほかに個人の情報を入れない
export async function sendCodeMail(to: string, code: string, appName: string): Promise<{ ok: boolean; detail?: string }> {
  const text = [
    `${appName}へのログインの確認コードです。`,
    "",
    `確認コード: ${code}`,
    "",
    "ログインの画面に、この6けたの数字を入力してください。有効期限は10分です。",
    "",
    "このメールに心当たりがない場合は、どなたかがあなたのパスワードでログインしようとした可能性があります。",
    "確認コードは誰にも伝えず、パスワードを変更してください(ログイン画面の「パスワードを忘れた方」から変更できます)。",
    "",
    "うえまつ産業医事務所",
  ].join("\n");
  return sendMail(to, `【${appName}】ログインの確認コード ${code}`, text);
}

export type SendResult =
  | { ok: true; done: true } // 確認は不要、またはすでに確認済み(覚えた端末を含む)
  | { ok: true; done: false; wait: number } // コードを送った。wait 秒たつと送り直せる
  | { ok: false; status: number; error: string; wait?: number };

// 確認コードを発行して送る(対象でない方が、事務所の設定画面から試しに受け取るときにも使う)
export async function issueAndSend(user: { id: string; email?: string }, appName: string): Promise<SendResult> {
  const admin = adminClient();
  if (!admin || !mailReady()) return { ok: false, status: 503, error: "確認コードを送る準備ができていません(サーバーの設定が未完了です)。産業医事務所へご連絡ください。" };
  if (!user.email) return { ok: false, status: 400, error: "メールアドレスが登録されていないため、確認コードを送れません。" };
  const code = newCode();
  const { data, error } = await admin.rpc("second_step_issue", { p_user: user.id, p_code_hash: hashCode(user.id, code) });
  if (error) return { ok: false, status: 503, error: "確認コードを発行できませんでした。しばらくしてからお試しください。" };
  const r = (data ?? {}) as { ok?: boolean; reason?: string; wait?: number };
  if (!r.ok) {
    return r.reason === "wait"
      ? { ok: false, status: 429, error: `確認コードは送信済みです。届かないときは、${r.wait ?? 60}秒ほど待ってから送り直してください。`, wait: r.wait ?? 60 }
      : { ok: false, status: 429, error: "確認コードの送信回数が上限に達しました。1時間ほど待ってからお試しください。", wait: r.wait ?? 3600 };
  }
  const mail = await sendCodeMail(user.email, code, appName);
  if (!mail.ok) {
    console.error("second step mail failed", mail.detail);
    await admin.rpc("second_step_issue_failed", { p_user: user.id });
    return { ok: false, status: 502, error: "確認コードのメールを送れませんでした。少し待ってから「コードを送り直す」を押してください。" };
  }
  return { ok: true, done: false, wait: 60 };
}

// 確認コードを照合する。合っていれば、データベースがこのログインを確認済みにする。
// remember のときは端末の印も発行する(呼び出し側が、返事に目印と端末の印を付ける)
export async function checkCode(userId: string, sessionId: string, code: string, remember: boolean, label: string): Promise<{ result: string; device: string | null }> {
  const admin = adminClient();
  if (!admin) return { result: "error", device: null };
  const token = remember ? newDeviceToken() : null;
  const { data, error } = await admin.rpc("second_step_check", {
    p_user: userId,
    p_session: sessionId,
    p_code_hash: hashCode(userId, code),
    p_device_hash: token ? hashDevice(token) : null,
    p_label: label,
  });
  if (error) return { result: "error", device: null };
  return { result: String(data), device: data === "ok" ? token : null };
}

// このログインに、確認済みの記録があるか(対象でない方が試したときの確認にも使う)
export async function sessionVerified(userId: string, sessionId: string): Promise<boolean> {
  const admin = adminClient();
  if (!admin) return false;
  const { data } = await admin.from("login_verified_sessions").select("session_id").eq("session_id", sessionId).eq("user_id", userId).maybeSingle();
  return Boolean(data);
}
