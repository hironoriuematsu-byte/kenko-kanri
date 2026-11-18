import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stepBlocked } from "@/lib/secondStepState";
import { adminClient } from "@/lib/supabase/admin";
import { aiReady } from "@/lib/autoReadServer";
import { approveHeld, changeRound, loadUpload, pdfAutoSetting, purgeOldUploads, rereadUpload, runStep, stateOf, type Actor, type ReadResult } from "@/lib/autoReadRun";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// 健診結果の自動読み取り(AI)。
//   GET  ?id=…            読み取りの状態と結果
//        ?hash=…&companyId=…  同じファイルを前に送っていないか
//        ?list=1          確認待ち・読み取り中・失敗のファイル(事務所)
//        ?settings=1      設定(事務所)
//   POST { action: "run", uploadId }                    読み取りを1区切り進める
//        { action: "retry", uploadId }                  失敗したファイルをはじめから読み直す
//        { action: "approve" | "skip", uploadId, indexes, choices }  確認待ちの方を取り込む / 取り込まない(事務所)
//        { action: "reround", uploadId, round }         実施回を直して読み直す(事務所。まだ誰も取り込んでいないファイルだけ)
//        { action: "reread", uploadId }                 はじめから読み直す(事務所。まだ誰も取り込んでいないファイルだけ)
//        { action: "settings", pdfAuto }                設定を変える(事務所)

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

// ログイン中の利用者(実施者、または閲覧のみでない事業者担当者)
async function getActor(): Promise<Actor | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  // 二段階認証の対象の方は、確認コードの入力が済んでから
  if (await stepBlocked(supabase)) return null;
  let { data: p } = await supabase.from("profiles").select("id, role, company_id, hm_company_access, hm_view_only").eq("id", user.id).maybeSingle();
  if (!p) ({ data: p } = (await supabase.from("profiles").select("id, role, company_id").eq("id", user.id).maybeSingle()) as { data: typeof p });
  if (!p) return null;
  if (p.role === "office") return { id: user.id, role: "office", companyId: null };
  const isCompany = p.role === "company" || (p.hm_company_access && (p.role === "employee" || p.role === "jimu"));
  if (isCompany && !p.hm_view_only && p.company_id) return { id: user.id, role: "company", companyId: p.company_id as string };
  return null;
}
const canUse = (actor: Actor, companyId: string) => actor.role === "office" || actor.companyId === companyId;

// 会社の担当者には、確認待ちの方の中身(承認用の控え)は返さない
const forCompany = (r: ReadResult | null): ReadResult | null => (r ? { ...r, people: r.people.map(({ row, read, ...rest }) => rest) } : null);

export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor) return fail(401, "ログインの有効期限が切れました。ページを再読み込みしてください。");
  const admin = adminClient();
  if (!admin) return NextResponse.json({ ready: false });
  const q = new URL(req.url).searchParams;

  if (q.get("settings")) {
    if (actor.role !== "office") return fail(403, "権限がありません");
    return NextResponse.json({ ready: true, aiReady: aiReady(), pdfAuto: await pdfAutoSetting(admin) });
  }

  if (q.get("list")) {
    if (actor.role !== "office") return fail(403, "権限がありません");
    purgeOldUploads(admin).catch((e) => console.error("purge failed", e)); // 保管の期限(5年)を過ぎた原本を消す
    const { data } = await admin
      .from("hm_csv_uploads")
      .select("id, company_id, file_name, kind, storage_path, fiscal_year, checkup_type, round, special_kind, created_at, read_status, read_result, read_error, read_work, companies(name)")
      .eq("status", "pending")
      .in("read_status", ["reading", "review", "failed"])
      .order("created_at", { ascending: true })
      .limit(100);
    type Row = { id: string; read_work: { chunks: { done: boolean }[] } | null; companies: { name: string } | { name: string }[] | null } & Record<string, unknown>;
    const items = ((data ?? []) as unknown as Row[]).map(({ read_work, companies, ...r }) => ({
      ...r,
      company_name: (Array.isArray(companies) ? companies[0]?.name : companies?.name) ?? "",
      progress: read_work ? { done: read_work.chunks.filter((c) => c.done).length, total: read_work.chunks.length } : null,
    }));
    return NextResponse.json({ ready: true, aiReady: aiReady(), items });
  }

  const hash = q.get("hash");
  if (hash) {
    const companyId = q.get("companyId") ?? "";
    if (!canUse(actor, companyId)) return fail(403, "権限がありません");
    const { data } = await admin
      .from("hm_csv_uploads")
      .select("id, file_name, created_at, status")
      .eq("company_id", companyId)
      .eq("file_hash", hash)
      .neq("status", "discarded")
      .order("created_at", { ascending: false })
      .limit(1);
    return NextResponse.json({ ready: true, duplicate: data?.[0] ?? null });
  }

  const u = await loadUpload(admin, q.get("id") ?? "");
  if (!u || !canUse(actor, u.company_id)) return fail(404, "ファイルが見つかりません");
  const s = stateOf(u);
  return NextResponse.json({ ready: true, ...s, result: actor.role === "office" ? s.result : forCompany(s.result) });
}

export async function POST(req: Request) {
  const actor = await getActor();
  if (!actor) return fail(401, "ログインの有効期限が切れました。ページを再読み込みしてください。");
  const admin = adminClient();
  if (!admin) return fail(503, "自動の読み取りは準備中です(設定が済むと使えるようになります)");
  let body: { action?: unknown; uploadId?: unknown; indexes?: unknown; choices?: unknown; pdfAuto?: unknown; hash?: unknown; round?: unknown; kinds?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "リクエスト形式が不正です");
  }

  if (body.action === "settings") {
    if (actor.role !== "office") return fail(403, "権限がありません");
    const { error } = await admin.from("hm_settings").upsert({ key: "pdf_auto", value: body.pdfAuto === true, updated_at: new Date().toISOString(), updated_by: actor.id });
    if (error) return fail(503, "準備がまだです(SQL 0155 を実行してください)");
    await admin.from("hm_access_logs").insert({ user_id: actor.id, action: "update", target_table: "hm_settings", detail: { key: "pdf_auto", value: body.pdfAuto === true } });
    return NextResponse.json({ ok: true, pdfAuto: body.pdfAuto === true });
  }

  const uploadId = typeof body.uploadId === "string" ? body.uploadId : "";
  const u = await loadUpload(admin, uploadId);
  if (!u) {
    // 列がまだ無い(SQL 0155 の実行前)ときも、ここに来る
    return fail(404, "ファイルが見つからないか、準備がまだです(SQL 0155)");
  }
  if (!canUse(actor, u.company_id)) return fail(403, "権限がありません");
  const out = (s: Awaited<ReturnType<typeof runStep>>) => NextResponse.json({ ready: true, ...s, result: actor.role === "office" ? s.result : forCompany(s.result) });

  if (body.action === "run") {
    // 送った直後に、ファイルの中身の照合用の値を記録する(同じファイルの送り直しに気づくため)
    if (typeof body.hash === "string" && /^[0-9a-f]{64}$/.test(body.hash) && !u.file_hash) {
      await admin.from("hm_csv_uploads").update({ file_hash: body.hash, uploaded_role: actor.role }).eq("id", u.id);
    }
    return out(await runStep(admin, uploadId, actor));
  }
  if (body.action === "retry") {
    if (u.status !== "pending" || u.read_status !== "failed") return out(stateOf(u));
    await admin.from("hm_csv_uploads").update({ read_status: "none", read_work: null, read_error: null, read_updated_at: null }).eq("id", u.id);
    return out(await runStep(admin, uploadId, actor));
  }
  if (body.action === "approve" || body.action === "skip") {
    if (actor.role !== "office") return fail(403, "確認待ちの取込は、産業医事務所が行います");
    if (u.read_status !== "review") return out(stateOf(u));
    const indexes = (Array.isArray(body.indexes) ? body.indexes : []).filter((x): x is number => Number.isInteger(x));
    const choices = (body.choices && typeof body.choices === "object" ? body.choices : {}) as Record<string, string[]>;
    // 見分けられなかった方について、事務所が選んだ種類(番号 → 種類)
    const kinds = Object.fromEntries(
      Object.entries(body.kinds && typeof body.kinds === "object" ? (body.kinds as Record<string, unknown>) : {}).filter((e): e is [string, string] => typeof e[1] === "string")
    );
    return out(await approveHeld(admin, uploadId, actor, indexes, choices, body.action === "skip", kinds));
  }
  if (body.action === "reround") {
    if (actor.role !== "office") return fail(403, "実施回の変更は、産業医事務所が行います");
    return out(await changeRound(admin, uploadId, actor, Number(body.round)));
  }
  if (body.action === "reread") {
    if (actor.role !== "office") return fail(403, "読み直しは、産業医事務所が行います");
    return out(await rereadUpload(admin, uploadId, actor));
  }
  return fail(400, "操作の指定が不正です");
}
