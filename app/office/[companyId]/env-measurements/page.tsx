import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import EnvMeasurementsPanel from "@/components/EnvMeasurementsPanel";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OfficeEnvMeasurementsPage({
  params,
}: {
  params: { companyId: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const supabase = createClient();
  const [{ data: company }, { data: rows }] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
    supabase
      .from("hm_env_measurements")
      .select("id, measurement_date, title, note, file_name, storage_path, uploaded_by")
      .eq("company_id", params.companyId)
      .order("measurement_date", { ascending: false, nullsFirst: false }),
  ]);
  if (!company) notFound();

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href={`/office/${company.id}`}>← {company.name}</Link>
        </p>
        <h1 className="page-title">{company.name} — 作業環境測定</h1>
        <div className="card">
          <EnvMeasurementsPanel
            companyId={company.id}
            initialRows={(rows as any[]) ?? []}
            role="office"
            currentUserId={profile.id}
          />
        </div>
      </main>
    </>
  );
}
