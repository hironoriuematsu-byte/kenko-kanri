// 従業員へ渡す通知文書(受診勧奨通知・産業医面談通知)の種類と既定文面(画面上で編集可能)
import type { CheckupRow } from "@/components/CheckupsTable";

export type NoticeKind = "consult" | "interview";

export type NoticeTemplate = {
  label: string; // タブ名
  title: string; // 表題
  body: string; // 本文(判定内容の前)
  closing: string; // 結び(判定内容の後)
  targetHint: string; // 「1. 通知する方を選ぶ」の説明
  isTarget: (c: CheckupRow) => boolean; // 最初からチェックを入れる方
  canMarkRecommended: boolean; // 出力後に受診勧奨の状態を「勧奨済」にできるか
  canRegisterInterview: boolean; // 面談日を決めて産業医面談管理に予定をまとめて登録できるか
  hasReportForm?: boolean; // 文書の下に「受診報告」欄(本人が記入して担当者へ提出する雛形)を付けるか
  hasQrReport?: boolean; // 本人専用のQRコード(スマートフォンから受診報告を送る)を印字するか
};

// 「受診報告」欄の既定の見出しと、受診結果の選択肢(文書に印字する)
export const REPORT_FORM_TITLE = "受診報告（受診後にご記入のうえ、担当部署へご提出ください）";
export const REPORT_FORM_RESULTS = ["異常なし", "経過観察", "治療開始（通院中）", "精密検査中", "その他"];

// 受診勧奨通知の対象:
//   受診勧奨の状態が「受診勧奨」(未対応)または「勧奨済」(再通知)
//   または 就業判定の判定条件が「受診が条件」
//   または 医師の意見に「受診」を含む(例: 肝機能異常あり内科（消化器内科）受診)
// 受診済・措置不要の方は対象にしない(手動で追加はできる)
function isConsultTarget(c: CheckupRow): boolean {
  if (c.followup_status === "done") return false;
  if (c.followup_status === "pending" || c.followup_status === "recommended") return true;
  if (c.work_judgment_condition === "consult") return true;
  return (c.work_judgment_note ?? "").includes("受診");
}

// 産業医面談通知の対象(一覧の「要産業医面談」の絞り込みと同じ):
//   就業判定が要就業制限・要休業、または医師の意見に「産業医面談」を含む
function isInterviewTarget(c: CheckupRow): boolean {
  if (c.work_judgment === "restricted" || c.work_judgment === "leave") return true;
  return (c.work_judgment_note ?? "").includes("産業医面談");
}

export const NOTICE_TEMPLATES: Record<NoticeKind, NoticeTemplate> = {
  consult: {
    label: "受診勧奨通知",
    title: "健康診断結果に基づく医療機関受診のご案内",
    body: `このたびの健康診断の結果について、産業医による確認を行いました。下記のとおり、医療機関での受診（精密検査・治療）をお勧めする所見がありましたので、お早めに受診してください。
受診後は、下のQRコードをスマートフォンで読み取り、受診報告を送信してください（スマートフォンをお持ちでない場合は、この用紙の下にある「受診報告」欄にご記入のうえ担当部署へご提出ください）。受診結果のわかる書類（結果報告書・診断書など）があれば、あわせて担当部署へご提出ください。ご不明な点がある場合は、担当部署または産業医までご相談ください。`,
    closing: `なお、受診の確認ができない場合は、産業医面談を行ったうえで、就業上の措置（就業制限など）が必要と判断されることがあります。ご自身の健康を守るため、早めの受診をお願いいたします。`,
    hasReportForm: true,
    hasQrReport: true,
    targetHint:
      "受診勧奨が「未対応」「勧奨済」の方、判定条件が「受診が条件」の方、医師の意見に「受診」を含む方に、はじめからチェックが入っています。",
    isTarget: isConsultTarget,
    canMarkRecommended: true,
    canRegisterInterview: false,
  },
  interview: {
    label: "産業医面談通知",
    title: "健康診断結果に基づく産業医面談のご案内",
    body: `このたびの健康診断の結果について、産業医による確認を行いました。
下記のとおり、産業医との面談が必要と判断されましたので、面談にご出席ください。

面談では、健康診断の結果と現在の体調・勤務の状況をうかがい、必要な就業上の配慮についてご相談します。
面談の日時・場所は下記のとおりです（記載がない場合は担当部署からご案内します）。
お薬手帳や医療機関の受診結果があればお持ちください。`,
    closing: `面談でお話しいただいた内容は産業医が守秘し、就業上必要な範囲に限って会社へ伝えます。

ご不明な点がある場合は、担当部署までお問い合わせください。`,
    targetHint:
      "就業判定が「要就業制限」「要休業」の方と、医師の意見に「産業医面談」を含む方に、はじめからチェックが入っています。",
    isTarget: isInterviewTarget,
    canMarkRecommended: false,
    canRegisterInterview: true,
  },
};

export const NOTICE_KINDS: NoticeKind[] = ["consult", "interview"];

export function noticeKindOf(value: string | undefined): NoticeKind {
  return value === "interview" ? "interview" : "consult";
}
