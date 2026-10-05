import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PersonsTable from "@/components/PersonsTable";
import AutoLinkAccountsButton from "@/components/AutoLinkAccountsButton";

// 従業員台帳(カルテ)一覧。office/company共用
export default async function PersonsSection({
  companyId,
  basePath,
  canLink = false,
}: {
  companyId: string;
  basePath: string;
  canLink?: boolean; // アカウントの自動紐付けボタンを出す(登録権限のある人)
}) {
  const supabase = createClient();
  const { data: persons } = await supabase
    .from("hm_persons")
    .select("id, full_name, kana, employee_no, department, user_id")
    .eq("company_id", companyId)
    .order("employee_no", { ascending: true, nullsFirst: false })
    .order("full_name");

  return (
    <div>
      <p style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Link className="btn orange" href={`${basePath}/new`}>
          ＋ 従業員を登録
        </Link>
        {canLink && (
          <AutoLinkAccountsButton
            companyId={companyId}
            unlinkedCount={(persons ?? []).filter((p) => !p.user_id).length}
          />
        )}
      </p>
      <PersonsTable persons={persons ?? []} />
    </div>
  );
}
