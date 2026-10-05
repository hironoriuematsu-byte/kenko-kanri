import PrintButton from "@/components/PrintButton";
import type { OfficeInfo } from "@/lib/officeInfo";
import type { ChemicalReport, OrganicReport } from "@/lib/specialReport";
import { formatDateJa } from "@/lib/fiscal";

// 入力支援サービスのトップページ(個別の様式のURLは直接開くとセッションエラーになるため)
const MHLW_URL = "https://www.chohyo-shien.mhlw.go.jp/index.html";

const th: React.CSSProperties = { whiteSpace: "nowrap" };
const num: React.CSSProperties = { textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const blank = <span className="muted">（記入）</span>;

function Num({ n }: { n: number }) {
  return (
    <td style={num}>
      <strong>{n}</strong> 人
    </td>
  );
}

// 共通の頭書き(事業場・対象年・健診年月日・産業医)
function Head({
  title,
  formName,
  companyName,
  fiscalYear,
  lastDate,
  count,
  officeInfo,
}: {
  title: string;
  formName: string;
  companyName: string;
  fiscalYear: number;
  lastDate: string | undefined;
  count: number;
  officeInfo: OfficeInfo | null;
}) {
  const physician = officeInfo?.physician_name ?? "上松弘典";
  const office = officeInfo?.office_name ?? "うえまつ産業医事務所";
  return (
    <>
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>
          {title}（{formName}）転記用集計
        </h1>
        <div className="muted" style={{ marginTop: 4 }}>
          {companyName} / {fiscalYear}年度
        </div>
      </div>
      <div className="notice no-print">
        労働基準監督署への報告は、厚生労働省の
        <a href={MHLW_URL} target="_blank" rel="noopener noreferrer">
          入力支援サービス
        </a>
        で行えます。下の数値を様式の同じ名前の欄にそのまま転記してください。「（記入）」の欄は健診データに無い情報なので、事業場で確認して記入します。
      </div>
      <table className="list" style={{ maxWidth: 620, marginBottom: 14 }}>
        <tbody>
          <tr>
            <th style={{ ...th, width: 220 }}>事業場の名称</th>
            <td>{companyName}</td>
          </tr>
          <tr>
            <th style={th}>労働保険番号 / 事業の種類 / 所在地</th>
            <td>{blank}</td>
          </tr>
          <tr>
            <th style={th}>在籍労働者数</th>
            <td>{blank}（健診年月日現在の常時使用する労働者数）</td>
          </tr>
          <tr>
            <th style={th}>対象年</th>
            <td>{fiscalYear}年（期間・報告回目は{blank}）</td>
          </tr>
          <tr>
            <th style={th}>健診年月日（最終実施日）</th>
            <td>{lastDate ? formatDateJa(lastDate) : "—"}</td>
          </tr>
          <tr>
            <th style={th}>健康診断実施機関の名称・所在地</th>
            <td>{blank}</td>
          </tr>
          <tr>
            <th style={th}>受診労働者数</th>
            <td>
              <strong>{count}</strong> 人
            </td>
          </tr>
          <tr>
            <th style={th}>産業医</th>
            <td>
              {physician}（{office}）
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

export function OrganicReportSheet({
  companyName,
  fiscalYear,
  report,
  officeInfo,
}: {
  companyName: string;
  fiscalYear: number;
  report: OrganicReport;
  officeInfo: OfficeInfo | null;
}) {
  const breakdown = Object.entries(report.instructedBreakdown)
    .map(([k, v]) => `${k} ${v}人`)
    .join("・");
  return (
    <div className="print-sheet">
      <Head
        title="有機溶剤等健康診断結果報告書"
        formName="様式第3号の2"
        companyName={companyName}
        fiscalYear={fiscalYear}
        lastDate={report.lastCheckupDate}
        count={report.count}
        officeInfo={officeInfo}
      />

      <h2 style={{ fontSize: 15, margin: "14px 0 6px" }}>有機溶剤業務名（別表1のコード）・従事労働者数</h2>
      <table className="list" style={{ maxWidth: 620, marginBottom: 14 }}>
        <tbody>
          <tr>
            <th style={{ ...th, width: 220 }}>有機溶剤業務コード</th>
            <td>
              {report.workCodes.length > 0 ? report.workCodes.join("・") : "—"}
              <span className="muted" style={{ marginLeft: 8 }}>
                （健診データの「業務名番号」から。具体的業務内容は{blank}）
              </span>
            </td>
          </tr>
          <tr>
            <th style={th}>従事労働者数</th>
            <td>{blank}（健診年月日現在に有機溶剤業務に常時従事する労働者数。受診者数 {report.count} 人が目安）</td>
          </tr>
        </tbody>
      </table>

      <h2 style={{ fontSize: 15, margin: "14px 0 6px" }}>検査項目別の実施者数・有所見者数</h2>
      <table className="list" style={{ maxWidth: 620, marginBottom: 14 }}>
        <thead>
          <tr>
            <th>検査</th>
            <th style={num}>実施者数</th>
            <th style={num}>有所見者数</th>
          </tr>
        </thead>
        <tbody>
          {report.categories.map((c) => (
            <tr key={c.key}>
              <td>{c.label}</td>
              <Num n={c.examined} />
              <Num n={c.findings} />
            </tr>
          ))}
          <tr>
            <td>作業条件の調査人数</td>
            <Num n={report.workConditionCount} />
            <td />
          </tr>
          <tr>
            <td>所見のあった者の人数（他覚所見のみの者を除く）</td>
            <td />
            <Num n={report.findingsCount} />
          </tr>
          <tr>
            <td>
              医師の指示人数
              <div className="muted" style={{ fontSize: 12 }}>
                総合判定が B2・C・R・T（または D・E）の方{breakdown ? `：${breakdown}` : ""}
              </div>
            </td>
            <td />
            <Num n={report.instructedCount} />
          </tr>
        </tbody>
      </table>

      <h2 style={{ fontSize: 15, margin: "14px 0 6px" }}>代謝物の検査（別表2）</h2>
      {report.metabolites.length === 0 ? (
        <p className="muted">代謝物の検査の記録がありません。</p>
      ) : (
        <table className="list" style={{ maxWidth: 760, marginBottom: 14 }}>
          <thead>
            <tr>
              <th>検査</th>
              <th style={th}>有機溶剤コード</th>
              <th style={th}>検査内容コード</th>
              <th style={num}>実施者数</th>
              <th style={num}>分布1</th>
              <th style={num}>分布2</th>
              <th style={num}>分布3</th>
            </tr>
          </thead>
          <tbody>
            {report.metabolites.map((m) => (
              <tr key={m.key}>
                <td>
                  {m.label}
                  <div className="muted" style={{ fontSize: 12 }}>
                    {m.solventName}
                  </div>
                </td>
                <td style={num}>{m.solventCode}</td>
                <td style={num}>{m.testCode}</td>
                <Num n={m.examined} />
                <Num n={m.dist[0]} />
                <Num n={m.dist[1]} />
                <td style={num}>
                  <strong>{m.dist[2]}</strong> 人
                  {m.unknown > 0 && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      分布不明 {m.unknown}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted" style={{ fontSize: 12 }}>
        有所見は C 以上の判定（分布3 を含む）。腎機能検査は尿蛋白の検査を含みます。神経内科学的検査は健診データに項目が無い場合 0 人になります。
      </p>
      <div className="no-print" style={{ marginTop: 12 }}>
        <PrintButton />
      </div>
    </div>
  );
}

export function ChemicalReportSheet({
  companyName,
  fiscalYear,
  report,
  officeInfo,
}: {
  companyName: string;
  fiscalYear: number;
  report: ChemicalReport;
  officeInfo: OfficeInfo | null;
}) {
  return (
    <div className="print-sheet">
      <Head
        title="特定化学物質健康診断結果報告書"
        formName="様式第3号"
        companyName={companyName}
        fiscalYear={fiscalYear}
        lastDate={report.lastCheckupDate}
        count={report.count}
        officeInfo={officeInfo}
      />

      <h2 style={{ fontSize: 15, margin: "14px 0 6px" }}>特定化学物質業務の種別ごとの人数（別表のコード）</h2>
      {report.codes.length === 0 ? (
        <p className="muted">物質コードの記録がありません（取込時に「物質コード」「判定」の列を取り込んでください）。</p>
      ) : (
        <table className="list" style={{ maxWidth: 820, marginBottom: 14 }}>
          <thead>
            <tr>
              <th style={th}>業務コード</th>
              <th>特定化学物質・業務内容</th>
              <th style={num}>従事労働者数</th>
              <th style={num}>受診労働者数</th>
              <th style={num}>第二次健診を要する者</th>
              <th style={num}>有所見者数</th>
              <th style={num}>疾病にかかっていると診断された者</th>
            </tr>
          </thead>
          <tbody>
            {report.codes.map((c) => (
              <tr key={c.code}>
                <td style={num}>
                  <strong>{c.code}</strong>
                </td>
                <td>
                  {c.names.join("・") || "—"}
                  <div className="muted" style={{ fontSize: 12 }}>
                    {c.works.join("・")}
                    {Object.keys(c.judgments).length > 0 && (
                      <>
                        {" "}
                        / 判定: {Object.entries(c.judgments).map(([k, v]) => `${k} ${v}`).join("・")}
                      </>
                    )}
                  </div>
                </td>
                <td style={num}>{blank}</td>
                <Num n={c.examined} />
                <Num n={c.secondary} />
                <Num n={c.findings} />
                <Num n={c.disease} />
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {report.noCodeCount > 0 && (
        <p className="error-message">物質コードの項目が無い受診者が {report.noCodeCount} 人います（上の表には含まれていません）。</p>
      )}
      <p className="muted" style={{ fontSize: 12 }}>
        有所見者数は物質ごとの判定が A 以外（B1・B2・C・R・T）の人数、疾病にかかっていると診断された者は判定 C の人数、第二次健診を要する者は判定 B2 の人数です。
        従事労働者数は健診年月日現在に当該業務に常時従事する労働者数を事業場で確認して記入してください（受診労働者数が目安）。
        業務コードが3つを超える場合は、様式を複数枚使用します。
      </p>
      <div className="no-print" style={{ marginTop: 12 }}>
        <PrintButton />
      </div>
    </div>
  );
}
