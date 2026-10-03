import PrintButton from "@/components/PrintButton";
import type { OfficeInfo } from "@/lib/officeInfo";
import type { CheckupStats, Form6Summary } from "@/lib/checkupList";
import { formatDateJa } from "@/lib/fiscal";

const MHLW_URL = "https://www.chohyo-shien.mhlw.go.jp/inputsupport/servlet/com.inputsupport.ksinrepo";

// 定期健康診断結果報告書(様式第6号)に転記するための集計。
//   variant="inline": 健康診断管理の集計表の下に出す(受診者数などは上の表にあるので省く)
//   variant="sheet":  労基署報告の画面(印刷・PDF保存用。必要な数値をすべて載せる)
export default function Form6Sheet({
  variant,
  companyName,
  fiscalYear,
  round,
  stats,
  form6,
  officeInfo,
}: {
  variant: "inline" | "sheet";
  companyName: string;
  fiscalYear: number;
  round?: number;
  stats: CheckupStats;
  form6: Form6Summary;
  officeInfo: OfficeInfo | null;
}) {
  const sheet = variant === "sheet";
  const physician = officeInfo?.physician_name ?? "上松弘典";
  const office = officeInfo?.office_name ?? "うえまつ産業医事務所";

  return (
    <div className={sheet ? "print-sheet" : undefined}>
      {sheet && (
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>定期健康診断結果報告書（様式第6号）転記用集計</h1>
          <div className="muted" style={{ marginTop: 4 }}>
            {companyName} / {fiscalYear}年度{round ? `・第${round}回` : ""}
          </div>
        </div>
      )}

      <div className="notice no-print" style={{ marginTop: sheet ? 0 : 10 }}>
        労働基準監督署への報告は、厚生労働省の
        <a href={MHLW_URL} target="_blank" rel="noopener noreferrer">
          入力支援サービス
        </a>
        で行えます。{sheet ? "下の数値" : "上の集計（受診者数・有所見者数・医師の指示人数）と下の健診項目別の人数"}
        をそのまま転記してください。定期健診のみを集計し、受診者数・有所見者数は各区分の検査項目が記録されている方を1名として数えています（C以上の判定を有所見としています）。
      </div>

      <table className="list" style={{ maxWidth: 560, marginBottom: 14 }}>
        <tbody>
          {sheet && (
            <>
              <tr>
                <th style={{ width: 220 }}>事業場名</th>
                <td>{companyName}</td>
              </tr>
              <tr>
                <th>対象年度</th>
                <td>
                  {fiscalYear}年度{round ? `（第${round}回）` : ""}
                </td>
              </tr>
            </>
          )}
          <tr>
            <th style={{ width: 220 }}>健診年月日（最終実施日）</th>
            <td>{form6.lastCheckupDate ? formatDateJa(form6.lastCheckupDate) : "—"}</td>
          </tr>
          {sheet ? (
            <tr>
              <th>受診労働者数</th>
              <td>
                <strong>{form6.regularCount}</strong>名
                {form6.regularCount !== stats.total && (
                  <span className="muted" style={{ marginLeft: 8 }}>
                    （定期健診のみ。健康診断管理の一覧には定期健診以外 {stats.total - form6.regularCount}名を含みます）
                  </span>
                )}
              </td>
            </tr>
          ) : (
            form6.regularCount !== stats.total && (
              <tr>
                <th>受診労働者数（定期健診のみ）</th>
                <td>
                  <strong>{form6.regularCount}</strong>名
                  <span className="muted" style={{ marginLeft: 8 }}>
                    （上の集計には定期健診以外 {stats.total - form6.regularCount}名を含みます）
                  </span>
                </td>
              </tr>
            )
          )}
          {sheet && (
            <>
              <tr>
                <th>所見のあった者の人数</th>
                <td>
                  <strong>{stats.findings}</strong>名
                  <span className="muted" style={{ marginLeft: 8 }}>（C以上の判定がある方）</span>
                </td>
              </tr>
              <tr>
                <th>医師の指示人数</th>
                <td>
                  <strong>{stats.instructed}</strong>名
                  <span className="muted" style={{ marginLeft: 8 }}>（総合判定D）</span>
                </td>
              </tr>
            </>
          )}
          <tr>
            <th>産業医</th>
            <td>
              {physician}（{office}）
              <div className="muted">{officeInfo?.address || "所在地が未登録です（事務所の設定から登録できます）"}</div>
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
          {form6.categorySummary.map((s) => (
            <tr key={s.key}>
              <td>{s.label}</td>
              <td>{s.examined > 0 ? s.examined : <span className="muted">0</span>}</td>
              <td>{s.findings > 0 ? <strong style={{ color: "var(--danger)" }}>{s.findings}</strong> : <span className="muted">0</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {sheet && (
        <div className="no-print" style={{ marginTop: 18 }}>
          <PrintButton />
        </div>
      )}
    </div>
  );
}
