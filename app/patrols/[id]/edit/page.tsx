import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import PatrolForm from "@/components/PatrolForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { combinePatrolText } from "@/lib/patrols";

export const dynamic = "force-dynamic";

export default async function PatrolEditPage({ params }: { params: { id: string } }) {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const supabase = createClient();
  const { data: p } = await supabase
    .from("hm_patrols")
    .select("id, company_id, patrol_date, areas, findings, advice, note, physician_name, companies(name)")
    .eq("id", params.id)
    .single();
  if (!p) notFound();

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">
          {(p as any).companies?.name ?? ""} — 巡視記録の編集
        </h1>
        <div className="card">
          <PatrolForm
            physicianName={p.physician_name ?? profile.full_name ?? ""}
            backHref={`/patrols/${p.id}`}
            initial={{
              id: p.id,
              company_id: p.company_id,
              patrol_date: p.patrol_date ?? "",
              findings: combinePatrolText(p),
            }}
          />
        </div>
      </main>
    </>
  );
}
