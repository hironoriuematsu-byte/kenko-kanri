import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import PatrolsTable from "@/components/PatrolsTable";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OfficePatrolsPage({
  params,
}: {
  params: { companyId: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const supabase = createClient();
  const { data: company } = await supabase
    .from("companies")
    .select("id, name")
    .eq("id", params.companyId)
    .single();
  if (!company) notFound();

  const { data: patrols } = await supabase
    .from("hm_patrols")
    .select("id, patrol_date, areas, findings, advice, note, physician_name")
    .eq("company_id", company.id)
    .order("patrol_date", { ascending: false });

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href={`/office/${company.id}`}>← {company.name}</Link>
        </p>
        <h1 className="page-title">{company.name} — 産業医巡視記録</h1>
        <div className="card">
          <p>
            <Link className="btn orange" href={`/office/${company.id}/patrols/new`}>
              ＋ 巡視記録を作成
            </Link>
          </p>
          <PatrolsTable patrols={patrols ?? []} />
        </div>
      </main>
    </>
  );
}
