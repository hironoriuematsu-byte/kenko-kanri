import Link from "next/link";
import CheckupsTable from "@/components/CheckupsTable";
import RecentImports from "@/components/RecentImports";
import CsvUploadsStatus from "@/components/CsvUploadsStatus";
import CsvUploadsArchive from "@/components/CsvUploadsArchive";
import RecomputeJudgments from "@/components/RecomputeJudgments";
import WorkJudgmentReportButton from "@/components/WorkJudgmentReportButton";
import CheckupListCsvButton from "@/components/CheckupListCsvButton";
import Form6Sheet from "@/components/Form6Sheet";
import { loadCheckupList } from "@/lib/checkupList";

// 健診一覧+集計(サーバーコンポーネント)。office/company共用
export default async function CheckupsSection({
  companyId,
  companyName,
  basePath,
  selectedYear,
  selectedRound,
  canEdit,
  canDelete = false,
  canJudge = false,
}: {
  companyId: string;
  companyName: string;
  basePath: string;
  selectedYear?: number;
  selectedRound?: number; // 実施回(年に複数回の定期健診を行う事業場向け)
  canEdit: boolean;
  canDelete?: boolean;
  canJudge?: boolean;
}) {
  const { officeInfo, rules, years, year, rounds, round, roundQuery, list, items, stats, form6 } =
    await loadCheckupList(companyId, selectedYear, selectedRound);

  return (
    <div>
      {/* 事業者担当者が送ったCSVで、産業医事務所の取込待ちのもの */}
      <CsvUploadsStatus companyId={companyId} />
      <p style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {canEdit && (
          <>
            <Link className="btn orange" href={`${basePath}/import`}>
              {canDelete ? "健康診断結果取込" : "健康診断結果を送る（CSV・PDF）"}
            </Link>
            <Link className="btn secondary" href={`${basePath}/new`}>
              ＋ 個別入力
            </Link>
          </>
        )}
        {year && (
          <>
            {/* 事業者が就業上の措置を検討するための一覧 */}
            <WorkJudgmentReportButton
              companyName={companyName}
              fiscalYear={year}
              round={rounds.length > 1 ? round : undefined}
              rows={list}
              officeInfo={officeInfo}
            />
            {/* 検査値付きの一覧 */}
            <CheckupListCsvButton
              companyName={companyName}
              fiscalYear={year}
              round={rounds.length > 1 ? round : undefined}
              rows={list}
              items={items}
              officeInfo={officeInfo}
            />
            {/* 労働基準監督署への報告(様式第6号)に転記する数値を印刷・PDF保存できる画面 */}
            <Link className="btn secondary" href={`${basePath}/report?year=${year}${roundQuery}`}>
              労基署報告（様式第6号）
            </Link>
            {/* 受診勧奨となった従業員へ渡す通知文書(1人1ページ・まとめて印刷/PDF) */}
            <Link className="btn" href={`${basePath}/notices?year=${year}${roundQuery}`}>
              受診勧奨通知書（1人1ページ）
            </Link>
          </>
        )}
      </p>

      {/* 送られたファイルの原本(取込済み)は実施者だけが見られる */}
      {canDelete && <CsvUploadsArchive companyId={companyId} />}

      {/* 取込ミスの取り消し・判定の再計算は実施者のみ(canDelete) */}
      {canDelete && (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
          <RecentImports companyId={companyId} />
          {year && <RecomputeJudgments companyId={companyId} fiscalYear={year} rules={rules} />}
        </div>
      )}

      {years.length > 0 && (
        <p style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className="muted">年度:</span>
          {years.map((y) => (
            <Link key={y} href={`${basePath}?year=${y}`} className={y === year ? "badge" : ""} style={y === year ? {} : { padding: "2px 8px" }}>
              {y}年度
            </Link>
          ))}
          {/* 年に複数回の定期健診がある事業場では、実施回を分けて表示する */}
          {rounds.length > 1 && (
            <>
              <span className="muted" style={{ marginLeft: 12 }}>実施回:</span>
              {rounds.map((r) => (
                <Link
                  key={r}
                  href={`${basePath}?year=${year}&round=${r}`}
                  className={r === round ? "badge" : ""}
                  style={r === round ? {} : { padding: "2px 8px" }}
                >
                  第{r}回
                </Link>
              ))}
            </>
          )}
        </p>
      )}

      {year ? (
        <>
          <table className="list" style={{ marginBottom: 14, maxWidth: 560 }}>
            <tbody>
              <tr>
                <th>受診者数</th>
                <td>{stats.total}名</td>
                <th>有所見者数</th>
                <td>
                  {stats.findings}名
                  <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>（C以上の判定がある方）</span>
                </td>
              </tr>
              <tr>
                <th>有所見率</th>
                <td>{stats.rate !== null ? `${stats.rate}%` : <span className="muted">10名未満のため非表示</span>}</td>
                <th>医師の指示人数</th>
                <td>
                  {stats.instructed}名
                  <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>（総合判定D）</span>
                </td>
              </tr>
              <tr>
                <th>医師の指示人数率</th>
                <td>{stats.instructedRate !== null ? `${stats.instructedRate}%` : <span className="muted">10名未満のため非表示</span>}</td>
                <th>就業判定 要対応</th>
                <td>
                  {stats.attention > 0 ? <span className="badge orange">{stats.attention}名</span> : "0名"}
                  {stats.held > 0 && <span className="muted" style={{ marginLeft: 6 }}>（うち判定保留 {stats.held}名）</span>}
                </td>
              </tr>
              <tr>
                <th>受診勧奨</th>
                <td colSpan={3}>
                  {stats.followupPending > 0 ? <span className="badge orange">未対応 {stats.followupPending}名</span> : "未対応 0名"}
                  <span className="muted" style={{ marginLeft: 8 }}>
                    勧奨済 {stats.followupRecommended}名 / 受診済 {stats.followupDone}名
                    （総合判定D以上の方は取込時に「受診勧奨」になります。一覧の「受診勧奨」欄で更新できます）
                  </span>
                </td>
              </tr>
              {/* 就業制限項目(R)の行は実施者の画面だけに出す(企業担当者には列も出さない) */}
              {canDelete && (
                <tr>
                  <th>就業制限項目（R）</th>
                  <td colSpan={3}>
                    {stats.restrictionCount > 0 ? (
                      <>
                        <strong style={{ color: "var(--danger)" }}>{stats.restrictionCount}名</strong>
                        <span className="muted" style={{ marginLeft: 8 }}>
                          就業上の措置を検討する水準の項目があります（一覧の「就業制限項目（R）」欄）
                        </span>
                      </>
                    ) : (
                      "0名"
                    )}
                  </td>
                </tr>
              )}
              <tr>
                <th>就業制限・要休業</th>
                <td colSpan={3}>
                  {stats.restricted > 0 ? (
                    <>
                      <strong style={{ color: "var(--danger)" }}>{stats.restricted}名</strong>
                      <span className="muted" style={{ marginLeft: 8 }}>該当者の「医師の意見」欄をご確認のうえ、就業上の措置をご検討ください</span>
                    </>
                  ) : (
                    "0名"
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          {/* 労働基準監督署へ提出する定期健康診断結果報告書(様式第6号)に転記するための集計。
              最初から開いて表示し、見出しを押すと折りたたむ */}
          <details open style={{ marginBottom: 14 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>
              定期健康診断結果報告書（様式第6号）の転記用集計
              <span className="muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
                健診項目ごとの受診者数・有所見者数（見出しを押すと折りたたみ）
              </span>
            </summary>
            <Form6Sheet
              variant="inline"
              companyName={companyName}
              fiscalYear={year}
              round={rounds.length > 1 ? round : undefined}
              stats={stats}
              form6={form6}
              officeInfo={officeInfo}
            />
          </details>

          <CheckupsTable rows={list} canDelete={canDelete} canJudge={canJudge} canFollowup={canEdit} compact={!canDelete} />
        </>
      ) : (
        <p className="muted">健診結果はまだ登録されていません。</p>
      )}
    </div>
  );
}
