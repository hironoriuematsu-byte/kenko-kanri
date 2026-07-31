import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

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
      {(persons ?? []).length > 0 ? (
        <table className="list">
          <thead>
            <tr>
              <th>社員番号</th>
              <th>氏名</th>
              <th>フリガナ</th>
              <th>部署</th>
            </tr>
          </thead>
          <tbody>
            {(persons ?? []).map((p) => (
              <tr key={p.id}>
                <td>{p.employee_no || "—"}</td>
                <td>
                  <Link href={`/karte/${p.id}`}>{p.full_name}</Link>
                </td>
                <td className="muted">{p.kana ?? ""}</td>
                <td>{p.department ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">
          従業員はまだ登録されていません。「＋ 従業員を登録」からカルテを作成してください。
        </p>
      )}
    </div>
  );
}
