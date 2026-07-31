import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import PatrolsTable from "@/components/PatrolsTable";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CompanyPatrolsPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  const supabase = createClient();
  const { data: patrols } = await supabase
    .from("hm_patrols")
    .select("id, patrol_date, areas, physician_name")
    .eq("company_id", profile.company_id)
    .order("patrol_date", { ascending: false });

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href="/company">← ダッシュボード</Link>
        </p>
        <h1 className="page-title">産業医巡視記録</h1>
        <div className="card">
          <PatrolsTable patrols={patrols ?? []} />
          <p className="muted" style={{ marginTop: 10 }}>
            巡視記録は産業医事務所が作成します。
          </p>
        </div>
      </main>
    </>
  );
}
