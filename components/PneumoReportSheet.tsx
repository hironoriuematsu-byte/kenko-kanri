import Link from "next/link";
import PrintButton from "@/components/PrintButton";
import type { OfficeInfo } from "@/lib/officeInfo";
import { COMPLICATION_LABEL, type PneumoReport } from "@/lib/pneumo";
import { formatDateJa } from "@/lib/fiscal";

// じん肺健康管理実施状況報告(じん肺法施行規則 様式第8号)の転記用集計。
// 欄の名前と並びは様式に合わせる(京都労働局「様式第8号の記入方法」R5.6)

const MHLW_URL = "https://www.chohyo-shien.mhlw.go.jp/index.html";
const th: React.CSSProperties = { whiteSpace: "nowrap" };
const num: React.CSSProperties = { textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const blank = <span className="muted">（記入）</span>;

function N({ n }: { n: number }) {
  return (
    <td style={num}>
      <strong>{n}</strong> 人
    </td>
  );
}

export default function PneumoReportSheet({
  companyName,
  report,
  officeInfo,
  registerHref,
  yearHref,
  ready,
}: {
  companyName: string;
  report: PneumoReport;
  officeInfo: OfficeInfo | null;
  registerHref: string; // 台帳の画面
  yearHref: (year: number) => string; // 対象年の切り替え
  ready: boolean; // SQL 0153 の実行済みか
}) {
  const physician = officeInfo?.physician_name ?? "上松弘典";
  const office = officeInfo?.office_name ?? "うえまつ産業医事務所";
  const r = report;
  return (
    <div className="print-sheet">
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>じん肺健康管理実施状況報告（様式第8号）転記用集計</h1>
        <div className="muted" style={{ marginTop: 4 }}>
          {companyName} / {r.year}年分（{r.year}年12月末現在）
        </div>
      </div>
      <div className="no-print" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <span className="muted">対象年:</span>
        <Link href={yearHref(r.year - 1)}>← {r.year - 1}年</Link>
        <strong>{r.year}年</strong>
        <Link href={yearHref(r.year + 1)}>{r.year + 1}年 →</Link>
        <Link className="btn secondary" href={registerHref} style={{ marginLeft: "auto" }}>
          じん肺健康管理台帳を入力・編集する
        </Link>
      </div>
      <div className="notice no-print">
        毎年12月末現在の「じん肺健康管理の状況」を、翌年2月末までに労働基準監督署へ報告します（じん肺健康診断を行わない年も報告が必要です）。報告は厚生労働省の
        <a href={MHLW_URL} target="_blank" rel="noopener noreferrer">
          入力支援サービス
        </a>
        でも作れます。下の数値は「じん肺健康管理台帳」から数えています。健康診断管理で「特殊健診(じん肺)」として登録した健診は、台帳に自動で入ります。「（記入）」の欄は事業場で確認して記入してください。
      </div>
      {!ready && (
        <div className="notice no-print" style={{ borderColor: "var(--orange)" }}>
          じん肺健康管理台帳の準備（SQL 0153 の実行）がまだのため、集計できません。
        </div>
      )}

      <table className="list kv" style={{ maxWidth: 680, marginBottom: 14 }}>
        <tbody>
          <tr>
            <th style={{ ...th, width: 240 }}>事業場の名称</th>
            <td>{companyName}</td>
          </tr>
          <tr>
            <th style={th}>労働保険番号 / 事業の種類 / 所在地</th>
            <td>{blank}</td>
          </tr>
          <tr>
            <th style={th}>在籍労働者（12月末日現在）</th>
            <td>{blank}（パートタイマー等を含む常時使用する労働者数。企業全体ではなく事業場の人数）</td>
          </tr>
          <tr>
            <th style={th}>対象期間</th>
            <td>{r.year}年</td>
          </tr>
          <tr>
            <th style={th}>健診年月日</th>
            <td>{r.lastExamDate ? formatDateJa(r.lastExamDate) : "—（この年はじん肺健康診断の記録がありません。その場合は無記入）"}（複数回は最終の年月日）</td>
          </tr>
          <tr>
            <th style={th}>定期健康診断実施機関の名称・所在地</th>
            <td>{blank}</td>
          </tr>
        </tbody>
      </table>

      <h2 style={{ fontSize: 15, margin: "14px 0 6px" }}>粉じん作業従事労働者数（12月末現在）</h2>
      {r.workCodes.length === 0 ? (
        <p className="muted">12月末現在、粉じん作業に従事している方は台帳にいません。</p>
      ) : (
        <table className="list" style={{ maxWidth: 480, marginBottom: 6 }}>
          <thead>
            <tr>
              <th>粉じん作業コード</th>
              <th style={num}>上記作業従事労働者数</th>
            </tr>
          </thead>
          <tbody>
            {r.workCodes.map((c) => (
              <tr key={c.code || "none"}>
                <td>{c.code || <span className="muted">（コード未入力）</span>}</td>
                <N n={c.count} />
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {r.workCodes.length > 4 && <p className="muted" style={{ fontSize: 12 }}>様式の欄は4つです。主要な粉じん作業を4つまで記入してください。</p>}

      <h2 style={{ fontSize: 15, margin: "14px 0 6px" }}>本年中に実施したじん肺健康診断実施者の延数</h2>
      <table className="list kv" style={{ maxWidth: 680, marginBottom: 14 }}>
        <tbody>
          <tr>
            <th style={{ ...th, width: 300 }}>(イ) 就業時健康診断（法第7条）</th>
            <N n={r.exams.hiring} />
          </tr>
          <tr>
            <th style={th}>(ロ) 定期健康診断（法第8条） 小計</th>
            <N n={r.exams.periodic} />
          </tr>
          {[
            "第1号（現在粉じん作業に従事・管理1）",
            "第2号（現在粉じん作業に従事・管理2又は3）",
            "第3号（以前粉じん作業に従事・管理2）",
            "第4号（以前粉じん作業に従事・管理3）",
          ].map((label, i) => (
            <tr key={label}>
              <td style={{ paddingLeft: 28 }}>{label}</td>
              <N n={r.exams.periodicByClass[i]} />
            </tr>
          ))}
          {r.exams.periodicUnclassified > 0 && (
            <tr>
              <td style={{ paddingLeft: 28 }} className="muted">
                第1号〜第4号に当てはまらない定期健診（管理4 など。台帳の内容を確認してください）
              </td>
              <N n={r.exams.periodicUnclassified} />
            </tr>
          )}
          <tr>
            <th style={th}>(ハ) 定期外健康診断（法第9条） 小計</th>
            <N n={r.exams.extra} />
          </tr>
          <tr>
            <td style={{ paddingLeft: 28 }}>いずれのうち肺がんに関する検査の実施者</td>
            <N n={r.exams.extraLungCancer} />
          </tr>
          <tr>
            <th style={th}>(ニ) 離職時健康診断（法第9条の2）</th>
            <N n={r.exams.leaving} />
          </tr>
          <tr>
            <th style={th}>計（(イ)〜(ニ)）</th>
            <N n={r.exams.total} />
          </tr>
        </tbody>
      </table>

      <h2 style={{ fontSize: 15, margin: "14px 0 6px" }}>(*1) 粉じん作業従事労働者及び粉じん作業に従事したことがある労働者のじん肺管理区分別内訳（12月末現在）</h2>
      <table className="list kv" style={{ maxWidth: 680, marginBottom: 14 }}>
        <tbody>
          <tr>
            <th style={{ ...th, width: 300 }}>計（(イ)〜(ホ)）</th>
            <N n={r.kanri.total} />
          </tr>
          {r.kanri.pending > 0 && (
            <tr>
              <td colSpan={2} style={{ color: "#B45309", fontWeight: 700 }}>
                ⚠ じん肺健診で所見あり(第1型以上)となり、管理区分の決定を待っている方が {r.kanri.pending} 人います(この内訳には数えていません)。
                決定通知書が届いたら台帳で管理区分を入れてください。
              </td>
            </tr>
          )}
          <tr>
            <th style={th}>(イ) 管理1</th>
            <N n={r.kanri.k1} />
          </tr>
          <tr>
            <th style={th}>有所見者数小計（(ロ)〜(ホ)）</th>
            <N n={r.kanri.findings} />
          </tr>
          <tr>
            <th style={th}>(ロ) 管理2</th>
            <N n={r.kanri.k2} />
          </tr>
          <tr>
            <th style={th}>(ハ) 管理3イ</th>
            <N n={r.kanri.k3i} />
          </tr>
          <tr>
            <td style={{ paddingLeft: 28 }}>(ニ) 管理3ロ PR3</td>
            <N n={r.kanri.k3ro.PR3} />
          </tr>
          <tr>
            <td style={{ paddingLeft: 28 }}>(ニ) 管理3ロ PR4(A,B)</td>
            <N n={r.kanri.k3ro.PR4AB} />
          </tr>
          {r.kanri.k3ro.unknown > 0 && (
            <tr>
              <td style={{ paddingLeft: 28 }} className="muted">
                管理3ロで内訳（PR3・PR4(A,B)）が未入力
              </td>
              <N n={r.kanri.k3ro.unknown} />
            </tr>
          )}
          <tr>
            <td style={{ paddingLeft: 28 }}>(ホ) 管理4 PR4(C)</td>
            <N n={r.kanri.k4.PR4C} />
          </tr>
          <tr>
            <td style={{ paddingLeft: 28 }}>(ホ) 管理4 F(++)</td>
            <N n={r.kanri.k4["F++"]} />
          </tr>
          <tr>
            <td style={{ paddingLeft: 28 }}>(ホ) 管理4 その他</td>
            <N n={r.kanri.k4.other} />
          </tr>
        </tbody>
      </table>

      <table className="list kv" style={{ maxWidth: 680, marginBottom: 14 }}>
        <tbody>
          <tr>
            <th style={{ ...th, width: 300 }}>
              従来管理1であった労働者で、本年中に
              <br />
              新たに管理2、管理3又は管理4と決定されたものの数
            </th>
            <N n={r.newlyFrom1} />
          </tr>
          <tr>
            <th style={th}>
              (*2) 本年中に粉じん作業から他の作業に
              <br />
              転換した労働者の数 計（管理1を含む）
            </th>
            <N n={r.transferred.total} />
          </tr>
          <tr>
            <td style={{ paddingLeft: 28 }}>うち管理2 / 管理3イ / 管理3ロ</td>
            <td style={num}>
              <strong>{r.transferred.k2}</strong> / <strong>{r.transferred.k3i}</strong> / <strong>{r.transferred.k3ro}</strong> 人
            </td>
          </tr>
          <tr>
            <th style={th}>
              過去に粉じん作業に従事させたことのある労働者で、12月末現在
              <br />
              非粉じん作業に従事し、管理2又は管理3であるものの総数
            </th>
            <N n={r.pastNonDust} />
          </tr>
          <tr>
            <th style={th}>
              (*3) 管理2又は管理3で、合併症により
              <br />
              本年中に療養を開始したものの数 計
            </th>
            <N n={r.complications.total} />
          </tr>
          {r.complications.byNo.map((n, i) =>
            n > 0 ? (
              <tr key={i}>
                <td style={{ paddingLeft: 28 }}>{COMPLICATION_LABEL[i + 1]}</td>
                <N n={n} />
              </tr>
            ) : null
          )}
        </tbody>
      </table>

      <table className="list kv" style={{ maxWidth: 680, marginBottom: 14 }}>
        <tbody>
          <tr>
            <th style={{ ...th, width: 240 }}>産業医</th>
            <td>
              {physician}（{office}）
              <span className="muted" style={{ marginLeft: 6 }}>※在籍労働者が50人以上の場合に記入</span>
            </td>
          </tr>
          <tr>
            <th style={th}>事業者職氏名</th>
            <td>{blank}</td>
          </tr>
        </tbody>
      </table>
      <div className="no-print">
        <PrintButton />
      </div>
    </div>
  );
}
