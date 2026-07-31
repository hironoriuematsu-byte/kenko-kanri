import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import CompanyAddressInline from "@/components/CompanyAddressInline";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MENU = [
  {
    href: "minutes",
    title: "安全衛生委員会議事録",
    desc: "議事録の作成・共有・印刷",
  },
  {
    href: "patrols",
    title: "産業医巡視記録",
    desc: "職場巡視の記録・指摘事項",
  },
  {
    href: "interviews",
    title: "産業医面談管理",
    desc: "面談予定・実施記録・意見書",
  },
  {
    href: "checkups",
    title: "健康診断",
    desc: "取込・有所見・就業判定・事後措置",
  },
  {
    href: "stress",
    title: "ストレスチェック",
    desc: "高ストレス者・集団サマリー",
  },
  {
    href: "persons",
    title: "個人カルテ",
    desc: "書類共有・文書作成・履歴",
  },
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

        <div className="card-grid" style={{ marginTop: 18 }}>
          {MENU.map((m) => (
            <Link
              key={m.href}
              href={`/office/${company.id}/${m.href}`}
              className="card"
              style={{ marginBottom: 0 }}
            >
              <strong style={{ color: "var(--teal-dark)" }}>{m.title}</strong>
              <div className="muted">{m.desc}</div>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
