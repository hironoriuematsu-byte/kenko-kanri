import { NextResponse } from "next/server";
import { currentLogin, setHintCookie, stepState, tryDevice } from "@/lib/secondStepServer";
import { SS_VERIFY_PATH, safeNext } from "@/lib/secondStep";

export const dynamic = "force-dynamic";

// ログイン直後の通り道。二段階認証が要るかを調べて、行き先を決める:
//   対象でない方・すでに確認済みの方・覚えた端末の方 → 目印を付けて、元の行き先へ
//   それ以外 → 確認コードの入力画面へ
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const { supabase, user, sessionId } = await currentLogin();
  if (!user) {
    const login = new URL("/login", url);
    login.searchParams.set("next", next);
    return NextResponse.redirect(login);
  }
  const go = (path: string, hint: boolean) => {
    const res = NextResponse.redirect(new URL(path, url));
    if (hint && sessionId) setHintCookie(res, sessionId);
    return res;
  };
  const s = await stepState(supabase);
  if (!s.required || s.verified) return go(next, true);
  if (sessionId && (await tryDevice(user.id, sessionId))) return go(next, true);
  return go(`${SS_VERIFY_PATH}?next=${encodeURIComponent(next)}`, false);
}
