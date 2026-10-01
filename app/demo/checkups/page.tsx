import Link from "next/link";
import DemoHeader from "@/components/DemoHeader";
import DemoNotice from "../DemoNotice";
import CheckupsTable from "@/components/CheckupsTable";
import { DEMO_COMPANY, DEMO_FISCAL_YEAR, DEMO_OFFICE, demoCheckups } from "@/lib/demo-data";
import { isFindingJudgment, isRestrictionJudgment, needsAttention } from "@/lib/checkups";
import { summarizeByCategory } from "@/lib/checkupReport";

export const metadata = { title: "健康診断管理(デモ) | 健康管理Web" };

// 紹介用デモ: 健康診断管理(産業医事務所の画面と同じ集計・一覧を架空データで表示。閲覧のみ)
export default function DemoCheckupsPage({ searchParams }: { searchParams: { view?: string } }) {
  // 企業担当者の画面(既定。有所見・要医療・就業制限の列を出さない簡易表示)と産業医事務所の画面を切り替えられる。
  // デモは主に企業担当者にお見せするため、企業担当者の画面を先に出す
  const company = searchParams.view !== "office";
  const { rows, items } = demoCheckups();
  const total = rows.length;
  const findings = rows.filter(
    (c) => c.has_findings || isFindingJudgment(c.overall_judgment) || (c.findingItems ?? []).some((it) => isFindingJudgment(it.judgment))
  ).length;
  const instructed = rows.filter((c) => (c.overall_judgment ?? "").startsWith("D")).length;
  const rate = Math.round((findings / total) * 1000) / 10;
  const instructedRate = Math.round((instructed / total) * 1000) / 10;
  const restrictionCount = rows.filter((c) => (c.findingItems ?? []).some((it) => isRestrictionJudgment(it.judgment))).length;
  const attention = rows.filter((c) => needsAttention(c.work_judgment)).length;
  const held = rows.filter((c) => c.work_judgment === "pending").length;
  const restricted = rows.filter((c) => c.work_judgment === "restricted" || c.work_judgment === "leave").length;
  const followupPending = rows.filter((c) => c.followup_status === "pending").length;
  const followupRecommended = rows.filter((c) => c.followup_status === "recommended").length;
  const followupDone = rows.filter((c) => c.followup_status === "done").length;
  const categorySummary = summarizeByCategory(items);
  const lastCheckupDate = rows.map((c) => c.checkup_date).filter(Boolean).sort().slice(-1)[0];

  return (
    <>
      <DemoHeader />
      <main className="container">
        <p className="muted">
          <Link href="/demo">← デモの目次</Link>
        </p>
        <h1 className="page-title">{DEMO_COMPANY} — 健康診断管理</h1>
        <DemoNotice />
        <p style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 13 }}>見る立場:</span>
          <Link className={company ? "btn" : "btn secondary"} href="/demo/checkups" style={{ padding: "4px 12px", fontSize: 13 }}>
            企業担当者の画面
          </Link>
          <Link className={company ? "btn secondary" : "btn"} href="/demo/checkups?view=office" style={{ padding: "4px 12px", fontSize: 13 }}>
            産業医事務所の画面
          </Link>
          <span className="muted" style={{ fontSize: 12 }}>
            {company
              ? "企業担当者には、就業判定・医師の意見・受診勧奨の状態が見えます(検査項目ごとの有所見は表示しません)。"
              : "産業医事務所には、有所見項目(C)・要医療項目(D)・就業制限項目(R)も表示され、就業判定を入力できます。"}
          </span>
        </p>
        <div className="card">
          <p style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span className="btn orange" aria-disabled style={{ opacity: 0.6, cursor: "default" }}>
              {company ? "健康診断結果を送る（CSV・PDF）" : "健康診断結果取込"}
            </span>
            <span className="btn secondary" aria-disabled style={{ opacity: 0.6, cursor: "default" }}>＋ 個別入力</span>
            <span className="btn" aria-disabled style={{ opacity: 0.6, cursor: "default" }}>就業判定結果出力</span>
            <span className="btn secondary" aria-disabled style={{ opacity: 0.6, cursor: "default" }}>健康診断結果出力</span>
          </p>
          <p className="muted" style={{ fontSize: 12.5 }}>
            {company
              ? "実際の画面では、健診機関のCSV・PDFをそのまま産業医事務所に送れます。就業判定結果・健康診断結果のCSV出力もできます(デモでは無効)。"
              : "実際の画面では、健診機関のCSVの取込、1名ずつの個別入力、就業判定結果・健康診断結果のCSV出力ができます(デモでは無効)。"}
          </p>

          <p style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="muted">年度:</span>
            <span className="badge">{DEMO_FISCAL_YEAR}年度</span>
          </p>

          <table className="list" style={{ marginBottom: 14, maxWidth: 560 }}>
            <tbody>
              <tr>
                <th>受診者数</th>
                <td>{total}名</td>
                <th>有所見者数</th>
                <td>
                  {findings}名
                  <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>（C以上の判定がある方）</span>
                </td>
              </tr>
              <tr>
                <th>有所見率</th>
                <td>{rate}%</td>
                <th>医師の指示人数</th>
                <td>
                  {instructed}名
                  <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>（総合判定D）</span>
                </td>
              </tr>
              <tr>
                <th>医師の指示人数率</th>
                <td>{instructedRate}%</td>
                <th>就業判定 要対応</th>
                <td>
                  {attention > 0 ? <span className="badge orange">{attention}名</span> : "0名"}
                  {held > 0 && <span className="muted" style={{ marginLeft: 6 }}>（うち判定保留 {held}名）</span>}
                </td>
              </tr>
              <tr>
                <th>受診勧奨</th>
                <td colSpan={3}>
                  {followupPending > 0 ? <span className="badge orange">未対応 {followupPending}名</span> : "未対応 0名"}
                  <span className="muted" style={{ marginLeft: 8 }}>
                    勧奨済 {followupRecommended}名 / 受診済 {followupDone}名
                    （総合判定D以上の方は取込時に「受診勧奨」になります。一覧の「受診勧奨」欄で更新できます）
                  </span>
                </td>
              </tr>
              {!company && (
                <tr>
                  <th>就業制限項目（R）</th>
                  <td colSpan={3}>{restrictionCount > 0 ? <strong style={{ color: "var(--danger)" }}>{restrictionCount}名</strong> : "0名"}</td>
                </tr>
              )}
              <tr>
                <th>就業制限・要休業</th>
                <td colSpan={3}>
                  {restricted > 0 ? (
                    <>
                      <strong style={{ color: "var(--danger)" }}>{restricted}名</strong>
                      <span className="muted" style={{ marginLeft: 8 }}>該当者の「医師の意見」欄をご確認のうえ、就業上の措置をご検討ください</span>
                    </>
                  ) : (
                    "0名"
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          <details style={{ marginBottom: 14 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>
              定期健康診断結果報告書（様式第6号）の転記用集計
              <span className="muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12 }}>健診項目ごとの受診者数・有所見者数</span>
            </summary>
            <div className="notice" style={{ marginTop: 10 }}>
              労働基準監督署への報告は、厚生労働省の入力支援サービスで行えます。上の集計（受診者数・有所見者数・医師の指示人数）と下の健診項目別の人数をそのまま転記してください。
            </div>
            <table className="list" style={{ maxWidth: 560, marginBottom: 14 }}>
              <tbody>
                <tr>
                  <th style={{ width: 220 }}>健診年月日（最終実施日）</th>
                  <td>{lastCheckupDate ?? "—"}</td>
                </tr>
                <tr>
                  <th>産業医</th>
                  <td>
                    {DEMO_OFFICE.physician_name}（{DEMO_OFFICE.office_name}）
                    <div className="muted">{DEMO_OFFICE.address}</div>
                  </td>
                </tr>
              </tbody>
            </table>
            <table className="list" style={{ maxWidth: 560 }}>
              <thead>
                <tr>
                  <th>健診項目</th>
                  <th style={{ width: 110 }}>受診者数</th>
                  <th style={{ width: 110 }}>有所見者数</th>
                </tr>
              </thead>
              <tbody>
                {categorySummary.map((s) => (
                  <tr key={s.key}>
                    <td>{s.label}</td>
                    <td>{s.examined > 0 ? s.examined : <span className="muted">0</span>}</td>
                    <td>{s.findings > 0 ? <strong style={{ color: "var(--danger)" }}>{s.findings}</strong> : <span className="muted">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          <p className="muted" style={{ fontSize: 12.5 }}>
            {company
              ? "実際の画面では、企業担当者は「受診勧奨」の状態(勧奨済・受診済)を更新できます(デモでは閲覧のみ)。"
              : "実際の画面では、産業医事務所は一覧の「就業判定」「医師の意見」「判定条件」をその場で入力・一括判定できます(デモでは閲覧のみ)。"}
          </p>
          <CheckupsTable rows={rows} canDelete={false} canJudge={false} canFollowup={false} demo compact={company} />
        </div>
      </main>
    </>
  );
}
