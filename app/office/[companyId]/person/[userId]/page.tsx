import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateJa } from "@/lib/fiscal";
import { CHECKUP_TYPES } from "@/lib/checkups";
import {
  INTERVIEW_TYPES,
  INTERVIEW_STATUS,
  WORK_JUDGMENTS,
  formatDateTimeJa,
} from "@/lib/interviews";

export const dynamic = "force-dynamic";

type TimelineEntry = {
  sortKey: string;
  dateLabel: string;
  kind: string;
  kindClass: "badge" | "badge orange";
  description: string;
  href?: string;
};

// 個人統合ビュー(officeのみ): 健診+ストレスチェック+面談を時系列で表示
export default async function PersonPage({
  params,
}: {
  params: { companyId: string; userId: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const supabase = createClient();
  const [{ data: company }, { data: person }] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
    supabase
      .from("profiles")
      .select("id, full_name, employee_no, department")
      .eq("id", params.userId)
      .single(),
  ]);
  if (!company || !person) notFound();

  await supabase.rpc("hm_log_access", {
    p_action: "view_person",
    p_target_table: "profiles",
    p_target_id: person.id,
  });

  const [{ data: checkups }, { data: interviews }, stressRes] = await Promise.all([
    supabase
      .from("hm_checkups")
      .select(
        "id, fiscal_year, checkup_type, checkup_date, overall_judgment, has_findings, work_judgment"
      )
      .eq("target_user_id", person.id)
      .order("fiscal_year", { ascending: false }),
    supabase
      .from("hm_interviews")
      .select("id, interview_type, scheduled_at, status")
      .eq("target_user_id", person.id)
      .order("scheduled_at", { ascending: false, nullsFirst: false }),
    supabase.rpc("hm_stress_history", { p_user_id: person.id }),
  ]);

  const entries: TimelineEntry[] = [];

  for (const c of checkups ?? []) {
    entries.push({
      sortKey: c.checkup_date ?? `${c.fiscal_year}-04-01`,
      dateLabel: c.checkup_date ? formatDateJa(c.checkup_date) : `${c.fiscal_year}年度`,
      kind: "健診",
      kindClass: c.has_findings ? "badge orange" : "badge",
      description: `${CHECKUP_TYPES[c.checkup_type] ?? c.checkup_type} 総合判定 ${
        c.overall_judgment || "—"
      }${c.has_findings ? "（有所見）" : ""}${
        c.work_judgment ? ` / 就業判定: ${WORK_JUDGMENTS[c.work_judgment]}` : ""
      }`,
      href: `/checkup/${c.id}`,
    });
  }

  for (const iv of interviews ?? []) {
    entries.push({
      sortKey: iv.scheduled_at?.slice(0, 10) ?? "0000-00-00",
      dateLabel: formatDateTimeJa(iv.scheduled_at),
      kind: "面談",
      kindClass: "badge",
      description: `${INTERVIEW_TYPES[iv.interview_type] ?? iv.interview_type}（${
        INTERVIEW_STATUS[iv.status] ?? iv.status
      }）`,
      href: `/interviews/${iv.id}`,
    });
  }

  const stressAvailable = !stressRes.error;
  for (const s of ((stressRes.data as any[]) ?? [])) {
    entries.push({
      sortKey: `${s.fiscal_year}-11-30`,
      dateLabel: `${s.fiscal_year}年度`,
      kind: "ストレスチェック",
      kindClass: s.is_high_stress ? "badge orange" : "badge",
      description: `${s.is_high_stress ? "高ストレス" : "高ストレスなし"}${
        s.interview_requested ? " / 面接指導申出あり" : ""
      }`,
    });
  }

  entries.sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href={`/office/${company.id}`}>← {company.name}</Link>
        </p>
        <h1 className="page-title">
          個人統合ビュー: {person.full_name ?? "—"}
          <span className="muted" style={{ fontSize: 14, marginLeft: 10 }}>
            {person.employee_no && `社員番号 ${person.employee_no} `}
            {person.department && ` / ${person.department}`}
          </span>
        </h1>

        {!stressAvailable && (
          <div className="notice">
            ストレスチェック連携が未設定のため、ストレスチェック歴は表示されていません。
          </div>
        )}

        <div className="card">
          <h2>時系列（健診・ストレスチェック・面談）</h2>
          {entries.length > 0 ? (
            <table className="list">
              <thead>
                <tr>
                  <th style={{ width: 180 }}>日付</th>
                  <th style={{ width: 150 }}>区分</th>
                  <th>内容</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i}>
                    <td>{e.dateLabel}</td>
                    <td>
                      <span className={e.kindClass}>{e.kind}</span>
                    </td>
                    <td>{e.href ? <Link href={e.href}>{e.description}</Link> : e.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">この従業員の記録はまだありません。</p>
          )}
          <p className="muted" style={{ marginTop: 10 }}>
            このビューはofficeのみ閲覧できます（閲覧はログに記録されます）。
          </p>
        </div>
      </main>
    </>
  );
}
