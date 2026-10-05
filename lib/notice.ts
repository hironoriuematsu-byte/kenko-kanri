// 受診勧奨通知文書の既定文面(画面上で編集可能)
import type { CheckupRow } from "@/components/CheckupsTable";

export const NOTICE_DEFAULT_TITLE = "健康診断結果に基づく医療機関受診のご案内";

export const NOTICE_DEFAULT_BODY = `このたびの健康診断の結果について、産業医による確認を行いました。
下記のとおり、医療機関での受診（精密検査・治療）をお勧めする所見がありましたので、お早めに受診してください。

受診後は、受診結果のわかる書類（結果報告書・診断書など）を担当部署までご提出ください。
ご不明な点がある場合は、担当部署または産業医までご相談ください。`;

export const NOTICE_DEFAULT_CLOSING = `ご自身の健康を守るため、早めの受診をお願いいたします。`;

// 受診勧奨通知の対象とみなす方:
//   受診勧奨の状態が「受診勧奨」(未対応)または「勧奨済」(再通知)
//   または 就業判定の判定条件が「受診が条件」
//   または 医師の意見に「受診」を含む(例: 肝機能異常あり内科（消化器内科）受診)
// 受診済・措置不要の方は対象にしない(手動で追加はできる)
export function isRecommendTarget(c: CheckupRow): boolean {
  if (c.followup_status === "done") return false;
  if (c.followup_status === "pending" || c.followup_status === "recommended") return true;
  if (c.work_judgment_condition === "consult") return true;
  return (c.work_judgment_note ?? "").includes("受診");
}
