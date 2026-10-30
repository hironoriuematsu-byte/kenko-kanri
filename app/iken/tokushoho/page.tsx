import Link from "next/link";
import { SELLER } from "@/lib/org";
import { IKEN_RETURN_DAYS } from "@/lib/businessDays";
import { MIN_SEATS, MIN_TOTAL, PAYMENT_METHODS_TEXT, SERVICE_NAME, UNIT_PRICE } from "@/lib/iken";

export const metadata = { title: `特定商取引法に基づく表記 | ${SERVICE_NAME}` };

const ROWS: [string, string][] = [
  ["販売事業者", `${SELLER.name}(うえまつ産業医事務所)`],
  ["適格請求書発行事業者登録番号", SELLER.invoiceRegistrationNo],
  ["運営責任者", SELLER.representative],
  ["所在地", SELLER.address],
  ["電話番号", "ご請求があれば遅滞なく開示します(下記メールアドレスまでご連絡ください)"],
  ["メールアドレス", SELLER.email],
  [
    "販売価格",
    `健診結果1件(1名1回の健康診断)あたり ${UNIT_PRICE}円(税込)、最低料金 ${MIN_TOTAL.toLocaleString()}円(税込・${MIN_SEATS}件まで)。件数の追加は1件 ${UNIT_PRICE}円(税込)から。お申込み時点の料金をお申込み画面に表示します`,
  ],
  ["商品代金以外の必要料金", "なし(インターネットの通信料はお客さまのご負担となります)"],
  ["支払方法", PAYMENT_METHODS_TEXT],
  ["支払時期", "お申込み時に決済されます"],
  [
    "サービスの提供時期",
    `決済完了後ただちに健診結果を送信できるようになります。医師の意見(就業判定)は、健診結果を受け付けた日から${IKEN_RETURN_DAYS}営業日以内にお返しします(土日・祝日・年末年始を除く)`,
  ],
  [
    "キャンセル・返金",
    "サービスの性質上、お申込み後のお客さまのご都合によるキャンセル・返金はお受けできません(送信した健診結果の件数が申込件数に満たない場合を含みます)。ただし、二重に決済された場合や、当社の事情によりサービスを提供できない場合は返金します",
  ],
  ["動作環境", "最新の Google Chrome / Microsoft Edge / Safari(パソコン・スマートフォン)"],
];

export default function TokushohoPage() {
  return (
    <div className="card" style={{ maxWidth: 820, margin: "0 auto" }}>
      <h1 className="page-title">特定商取引法に基づく表記</h1>
      <table className="list kv">
        <tbody>
          {ROWS.map(([k, v]) => (
            <tr key={k}>
              <th style={{ whiteSpace: "nowrap", verticalAlign: "top" }}>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 16 }}>
        <Link href="/iken">← サービスのご案内へ</Link>
      </p>
    </div>
  );
}
