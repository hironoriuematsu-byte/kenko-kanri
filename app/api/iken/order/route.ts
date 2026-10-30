import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/admin";
import { parseOrderInput, priceAdd, priceNew, SERVICE_NAME } from "@/lib/iken";
import { createCheckoutSession, stripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";
export const maxDuration = 60;

// 年度の申込・件数の追加(Web申込の事業場の担当者のみ)。申込を記録して Stripe の決済画面のURLを返す。
// 件数枠は支払い完了の通知(Webhook)で付ける
export async function POST(req: Request) {
  if (!stripeConfigured()) return NextResponse.json({ error: "現在、Web申込は準備中です。" }, { status: 503 });
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "サーバー設定エラー: SUPABASE_SERVICE_ROLE_KEY が未設定です" }, { status: 500 });

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "ログインの有効期限が切れました。ページを再読み込みしてください。" }, { status: 401 });

  let raw: Record<string, unknown>;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }
  const parsed = parseOrderInput(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { kind, fiscalYear, seats } = parsed.value;

  // 担当者と事業場を確かめる(service_role で読み、本人の所属だけを使う)
  const { data: prof } = await admin
    .from("profiles")
    .select("role, name, company_id, hm_company_access, hm_view_only")
    .eq("user_id", user.id)
    .maybeSingle();
  const p = prof as { role: string; name: string; company_id: string | null; hm_company_access?: boolean; hm_view_only?: boolean } | null;
  const isCompany = p && (p.role === "company" || (p.hm_company_access && (p.role === "jimu" || p.role === "employee")));
  if (!p || !isCompany || !p.company_id) return NextResponse.json({ error: "事業者担当者のアカウントでログインしてください" }, { status: 403 });
  if (p.hm_view_only) return NextResponse.json({ error: "閲覧のみの担当者はお申し込みできません" }, { status: 403 });

  const [{ data: ic }, { data: company }, { data: plan }] = await Promise.all([
    admin.from("hm_iken_companies").select("contact_email").eq("company_id", p.company_id).maybeSingle(),
    admin.from("companies").select("name").eq("id", p.company_id).maybeSingle(),
    admin.from("hm_iken_plans").select("seats").eq("company_id", p.company_id).eq("fiscal_year", fiscalYear).maybeSingle(),
  ]);
  if (!ic || !company) return NextResponse.json({ error: "Web申込の事業場ではありません。産業医事務所にお問い合わせください" }, { status: 403 });

  // 年度の申込は最初の1回(最低料金あり)。その年度の件数枠がすでにあれば「追加」として扱う
  const effectiveKind = kind === "new" && plan && plan.seats > 0 ? "add" : kind === "add" && !(plan && plan.seats > 0) ? "new" : kind;
  const price = effectiveKind === "new" ? priceNew(seats) : priceAdd(seats);
  const email = user.email ?? ic.contact_email;

  const { data: order, error } = await admin
    .from("hm_iken_orders")
    .insert({
      kind: effectiveKind,
      company_id: p.company_id,
      fiscal_year: fiscalYear,
      seats,
      seats_granted: price.granted,
      unit_price: price.lines[0].unitAmount,
      amount: price.total,
      company_name: company.name,
      contact_name: p.name,
      contact_email: email,
      ordered_by: user.id,
    })
    .select("id")
    .single();
  if (error || !order) return NextResponse.json({ error: `申込を記録できませんでした: ${error?.message ?? ""}` }, { status: 500 });

  const origin = process.env.NEXT_PUBLIC_SITE_URL || req.headers.get("origin") || new URL(req.url).origin;
  try {
    const session = await createCheckoutSession({
      orderId: order.id,
      email,
      companyName: company.name,
      total: price.total,
      lines: price.lines,
      successUrl: `${origin}/company/iken?paid=1`,
      cancelUrl: `${origin}/company/iken?canceled=1`,
      description: `${SERVICE_NAME} ${fiscalYear}年度${effectiveKind === "add" ? "(件数の追加)" : ""}`,
    });
    await admin.from("hm_iken_orders").update({ stripe_session_id: session.id }).eq("id", order.id);
    return NextResponse.json({ url: session.url });
  } catch (e) {
    await admin.from("hm_iken_orders").update({ status: "failed", error: String(e).slice(0, 500) }).eq("id", order.id);
    return NextResponse.json({ error: "決済画面を開けませんでした。時間をおいてもう一度お試しください。" }, { status: 502 });
  }
}
