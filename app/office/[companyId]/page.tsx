import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import CompanyAddressInline from "@/components/CompanyAddressInline";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MENU = [
  { href: "minutes", title: "衛生委員会議事録" },
  { href: "patrols", title: "産業医巡視記録" },
  { href: "hygiene-patrols", title: "衛生管理者巡視記録" },
  { href: "interviews", title: "産業医面談管理" },
  { href: "checkups", title: "健康診断管理" },
  { href: "stress", title: "ストレスチェック" },
  { href: "persons", title: "個人カルテ" },
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
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
