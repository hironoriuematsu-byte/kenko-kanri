import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import CompanyAddressInline from "@/components/CompanyAddressInline";
import MenuGrid from "@/components/MenuGrid";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MENU = [
  { href: "minutes", title: "衛生委員会議事録", icon: "📋", desc: "議事録の作成・共有・年度まとめ印刷" },
  { href: "hygiene-patrols", title: "衛生管理者巡視記録", icon: "✅", desc: "チェックリスト形式の職場巡視記録" },
  { href: "patrols", title: "産業医巡視記録", icon: "🔍", desc: "産業医による職場巡視・写真の記録" },
  { href: "env-measurements", title: "作業環境測定", icon: "📊", desc: "測定結果報告書のファイル保管・共有" },
  { href: "interviews", title: "産業医面談管理", icon: "💬", desc: "面談予定・実施記録・意見書" },
  { href: "checkups", title: "健康診断管理", icon: "🩺", desc: "取込・有所見・就業判定・事後措置" },
  { href: "stress", title: "ストレスチェック", icon: "📈", desc: "高ストレス者・集団サマリー" },
  { href: "persons", title: "個人カルテ", icon: "🗂️", desc: "書類共有・文書作成・履歴" },
];

export default async function OfficeCompanyPage({
  params,
}: {
  params: { companyId: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const supabase = createClient();
  const [{ data: company }, { data: companyInfo }] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
    supabase
      .from("hm_company_info")
      .select("address")
      .eq("company_id", params.companyId)
      .maybeSingle(),
  ]);
  if (!company) notFound();

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href="/office">← ダッシュボード</Link>
        </p>
        <h1 className="page-title" style={{ marginBottom: 4 }}>
          {company.name}{" "}
          <CompanyAddressInline
            companyId={company.id}
            initialAddress={companyInfo?.address ?? ""}
          />
        </h1>

        <MenuGrid
          items={MENU.map((m) => ({ ...m, href: `/office/${company.id}/${m.href}` }))}
        />
      </main>
    </>
  );
}
