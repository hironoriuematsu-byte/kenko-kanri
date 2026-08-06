import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import PrintButton from "@/components/PrintButton";
import HygienePatrolSheet from "@/components/HygienePatrolSheet";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// 直近10件の巡視記録をまとめて表示・印刷/PDF (company)
export default async function CompanyHygieneReportPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  const supabase = createClient();
  const [{ data: company }, { data: patrols }] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", profile.company_id).single(),
    supabase
      .from("hm_hygiene_patrols")
      .select("id, patrol_date, checklist_type, inspector_name, results, summary")
      .eq("company_id", profile.company_id)
      .order("patrol_date", { ascending: false })
      .limit(10),
  ]);

  await supabase.rpc("hm_log_access", {
    p_action: "print_batch",
    p_target_table: "hm_hygiene_patrols",
    p_target_id: null,
    p_detail: { company_id: profile.company_id, count: (patrols ?? []).length },
  });

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <div className="no-print" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
          <Link className="muted" href="/company/hygiene-patrols">
            ← 一覧に戻る
          </Link>
          <PrintButton />
          <span className="muted">直近{(patrols ?? []).length}件を表示しています。</span>
        </div>

        {(patrols ?? []).length === 0 ? (
          <div className="card">
            <p className="muted">巡視記録はまだありません。</p>
          </div>
        ) : (
          (patrols ?? []).map((p: any) => (
            <div className="card sheet-break" key={p.id}>
              <HygienePatrolSheet patrol={p} companyName={company?.name ?? ""} />
            </div>
          ))
        )}
      </main>
    </>
  );
}
