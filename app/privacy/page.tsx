import Link from "next/link";

export const metadata = {
  title: "個人情報の取扱いについて | 健康管理Web",
};

// 個人情報保護法第32条・施行令第10条に基づき、安全管理措置の概要
// (外国にある事業者のサービス利用を含む「外的環境の把握」)を本人の知り得る状態に置くページ。
// ログイン前でも読めるよう middleware の PUBLIC_PATHS に含めている。
// ストレスチェックWeb側の /privacy と内容を揃えること。事業者や保存場所を変更したときは両方を更新する。
const LAST_UPDATED = "2026年9月16日";
const CONTACT_EMAIL = "support@mestate.jp";
const OFFICE = "うえまつ産業医事務所";
const ADDRESS = "京都府京都市中京区錦小路通室町西入天神山町280 4階";

const h = { fontSize: 15, color: "var(--teal-dark, #0B6B62)", margin: "18px 0 6px", fontWeight: 700 } as const;
const p = { fontSize: 14, lineHeight: 1.9, margin: "0 0 8px" } as const;
const ul = { fontSize: 14, lineHeight: 1.9, margin: "0 0 8px", paddingLeft: 20 } as const;
const th = { textAlign: "left", padding: "6px 8px", background: "#EEF5F4", fontSize: 13, whiteSpace: "nowrap" } as const;
const td = { padding: "6px 8px", fontSize: 13, verticalAlign: "top", lineHeight: 1.6, borderTop: "1px solid #D9E4E2" } as const;

export default function PrivacyPage() {
  return (
    <div className="container" style={{ maxWidth: 820 }}>
      <div className="card">
        <h2 style={{ marginBottom: 4 }}>個人情報の取扱いについて</h2>
        <p className="muted" style={{ margin: "0 0 12px" }}>健康管理Web・ストレスチェックWeb　最終改定: {LAST_UPDATED}</p>

        <h3 style={h}>1. 実施者・管理者</h3>
        <p style={p}>
          {OFFICE}（Mestate LLC）　産業医: 上松 弘典
          <br />
          所在地: {ADDRESS}
        </p>

        <h3 style={h}>2. 取り扱う情報</h3>
        <p style={p}>
          氏名、社員番号、所属、メールアドレス、生年月日・性別、健康診断の結果と就業判定、面談記録、
          ストレスチェックの回答と結果、面接指導の申出と記録、閲覧記録。
        </p>

        <h3 style={h}>3. 利用目的</h3>
        <p style={p}>
          労働安全衛生法に基づく健康診断事後措置とストレスチェックの実施、結果の本人への通知、面接指導・面談の実施、
          個人が特定されない形での集団分析、法令に基づく記録の保存と報告。
        </p>

        <h3 style={h}>4. 情報を見ることができる人</h3>
        <p style={p}>
          本人、産業医、産業医事務所の担当者、および各企業の担当者（自社の従業員分に限り、人事権のない実施事務従事者または事業者担当者としての権限の範囲内）です。
          ストレスチェックの個人結果は、本人の同意がない限り会社に提供されません。
        </p>

        <h3 style={h}>5. 保存先と利用している外部サービス（外的環境の把握）</h3>
        <p style={p}>
          データは日本国内（東京）のサーバーに暗号化して保存しています。運用には次の外部事業者のサービスを利用しています。
          いずれも米国の事業者です。
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", border: "1px solid #D9E4E2" }}>
            <thead>
              <tr>
                <th style={th}>事業者（所在国）</th>
                <th style={th}>用途</th>
                <th style={th}>取り扱う情報</th>
                <th style={th}>保存・処理の場所</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={td}>Supabase, Inc.（米国）</td>
                <td style={td}>データベース、ログイン認証、ファイル保管</td>
                <td style={td}>上記2の情報一式（暗号化して保存）。事業者は保守・障害対応・法令に基づく場合を除きアクセスしません</td>
                <td style={td}>日本（東京）</td>
              </tr>
              <tr>
                <td style={td}>Vercel Inc.（米国）</td>
                <td style={td}>画面の配信と処理</td>
                <td style={td}>画面表示の際に情報が処理経路上を通過します。保存はしません</td>
                <td style={td}>日本（東京）</td>
              </tr>
              <tr>
                <td style={td}>Resend, Inc.（米国）</td>
                <td style={td}>招待・パスワード再設定メールの送信</td>
                <td style={td}>メールアドレスのみ。健康情報や結果は含めません</td>
                <td style={td}>米国</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p style={{ ...p, marginTop: 8 }}>
          米国には日本の個人情報保護法に相当する包括的な法律はなく、米国の法執行機関は適法な手続きに基づき米国事業者にデータの開示を求めることができる制度（CLOUD Act）があります。
          これを踏まえ、保存場所を国内に限定し、暗号化と閲覧権限の管理を行っています。
        </p>

        <h3 style={h}>6. 安全管理措置</h3>
        <ul style={ul}>
          <li>通信と保存時の暗号化</li>
          <li>閲覧権限のデータベースによる制御（企業ごとに自社分のみ）</li>
          <li>閲覧・出力の記録の保存</li>
          <li>一定時間操作がない場合の自動ログアウト</li>
          <li>外部事業者の規約・再委託先の変更の継続的な確認</li>
        </ul>

        <h3 style={h}>7. 保存期間</h3>
        <p style={p}>
          健康診断の結果は5年間（法令で別に定めがある項目はその期間）、ストレスチェックの結果は5年間保存し、期間経過後に消去します。
        </p>

        <h3 style={h}>8. 開示・訂正・利用停止・お問い合わせ</h3>
        <p style={p}>
          ご自身の情報の開示・訂正・利用停止のご請求、および取扱いに関するご質問は、{OFFICE}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ marginLeft: 4 }}>
            {CONTACT_EMAIL}
          </a>
          までご連絡ください。
        </p>

        <h3 style={h}>9. 改定</h3>
        <p style={p}>利用する外部事業者や保存場所を変更する場合は、事前にこのページとログイン画面でお知らせします。</p>

        <p style={{ marginTop: 16 }}>
          <Link href="/">← トップへ戻る</Link>
        </p>
      </div>
    </div>
  );
}
