import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { receiptPageUrl, stripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";

// 領収書(Stripe の請求書・領収書のページ)を開く。申込は RLS で自社(実施者は全件)のものだけ読める
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!stripeConfigured()) return NextResponse.json({ error: "決済の設定がありません" }, { status: 503 });
  const supabase = createClient();
  const { data: order } = await supabase
    .from("hm_iken_orders")
    .select("status, stripe_invoice_id, stripe_session_id")
    .eq("id", id)
    .maybeSingle();
  if (!order || order.status !== "paid") return NextResponse.json({ error: "領収書がありません" }, { status: 404 });
  try {
    const url = await receiptPageUrl({ invoiceId: order.stripe_invoice_id, sessionId: order.stripe_session_id });
    if (!url) return NextResponse.json({ error: "領収書がまだ発行されていません。しばらくしてからお試しください" }, { status: 404 });
    return NextResponse.redirect(url);
  } catch {
    return NextResponse.json({ error: "領収書を取り出せませんでした" }, { status: 502 });
  }
}
