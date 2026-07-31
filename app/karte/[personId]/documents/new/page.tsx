import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import DocumentForm from "@/components/DocumentForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DOC_TYPES } from "@/lib/karte";

export const dynamic = "force-dynamic";

export default async function DocumentNewPage({
  params,
}: {
  params: { personId: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const supabase = createClient();
  const { data: person } = await supabase
    .from("hm_persons")
    .select("id, company_id, full_name")
    .eq("id", params.personId)
    .single();
  if (!person) notFound();

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">文書の作成: {person.full_name}</h1>
        <div className="card">
          <DocumentForm
            backHref={`/karte/${person.id}`}
            initial={{
              person_id: person.id,
              company_id: person.company_id,
              doc_type: "referral_request",
              title: DOC_TYPES.referral_request,
              addressee: "",
              body: "",
              issued_date: new Date().toISOString().slice(0, 10),
              physician_name: profile.full_name ?? "上松弘典",
              visibility: "office_only",
            }}
          />
        </div>
      </main>
    </>
  );
}
