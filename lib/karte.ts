export const FILE_CATEGORIES: Record<string, string> = {
  medical_certificate: "診断書",
  referral: "診療情報提供書",
  checkup_report: "健診結果票",
  other: "その他",
};

export const DOC_TYPES: Record<string, string> = {
  referral_request: "診療情報提供依頼書",
  certificate_request: "診断書発行依頼書",
  other: "その他文書",
};

export const VISIBILITY_LABELS: Record<string, string> = {
  shared: "企業と共有",
  office_only: "産業医事務所のみ",
};

export const REFERRAL_REQUEST_TEMPLATE = `拝啓　時下ますますご清栄のこととお慶び申し上げます。

さて、下記従業員の産業保健業務(就業上の措置の検討)にあたり、貴院における診療情報(診断名・治療経過・検査結果・今後の見通し等)をご提供いただきたく、お願い申し上げます。

なお、本依頼は本人の同意を得たうえで行っております。ご多忙のところ恐縮ですが、何卒よろしくお願い申し上げます。

敬具

【依頼事項】
1. 診断名および現在の病状
2. 治療内容と経過
3. 就業上配慮すべき事項についてのご意見
`;
