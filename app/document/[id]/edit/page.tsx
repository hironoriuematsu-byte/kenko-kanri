import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import DocumentForm from "@/components/DocumentForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DocumentEditPage({ params }: { params: { id: string } }) {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const supabase = createClient();
  const { data: doc } = await supabase
    .from("hm_person_documents")
    .select(
      "id, person_id, company_id, doc_type, title, addressee, body, issued_date, physician_name, visibility, hm_persons(full_name)"
    )
    .eq("id", params.id)
    .single();
  if (!doc) notFound();

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">
          文書の編集: {(doc as any).hm_persons?.full_name ?? ""}
        </h1>
        <div className="card">
          <DocumentForm
            backHref={`/document/${doc.id}`}
            initial={{
              id: doc.id,
              person_id: doc.person_id,
              company_id: doc.company_id,
              doc_type: doc.doc_type,
              title: doc.title ?? "",
              addressee: doc.addressee ?? "",
              body: doc.body ?? "",
              issued_date: doc.issued_date ?? "",
              physician_name: doc.physician_name ?? profile.full_name ?? "上松弘典",
              visibility: doc.visibility,
            }}
          />
        </div>
      </main>
    </>
  );
}
