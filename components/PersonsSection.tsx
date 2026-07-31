import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PersonsTable from "@/components/PersonsTable";

// 従業員台帳(カルテ)一覧。office/company共用
export default async function PersonsSection({
  companyId,
  basePath,
}: {
  companyId: string;
  basePath: string;
}) {
  const supabase = createClient();
  const { data: persons } = await supabase
    .from("hm_persons")
    .select("id, full_name, kana, employee_no, department")
    .eq("company_id", companyId)
    .order("employee_no", { ascending: true, nullsFirst: false })
    .order("full_name");

  return (
    <div>
      <p>
        <Link className="btn orange" href={`${basePath}/new`}>
          ＋ 従業員を登録
        </Link>
      </p>
      <PersonsTable persons={persons ?? []} />
    </div>
  );
}
