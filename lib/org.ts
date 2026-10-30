// ============================================================
// 販売事業者・意見を述べる医師の表記(Web申込の特定商取引法に基づく表記・領収書・メールで使う)
// ストレスチェックWeb(stres の src/lib/org.ts)と同じ内容。変えるときは両方を直す
// ============================================================

export const DOCTOR = {
  name: "上松 弘典",
  full: "医師(産業医) 上松 弘典",
  officeName: "うえまつ産業医事務所",
  officeAddress: "京都府京都市中京区錦小路通室町西入天神山町280 4階",
  career: ["総合内科専門医", "労働衛生コンサルタント", "博士(社会健康医学)"],
} as const;

export const SELLER = {
  name: "メステート合同会社",
  issuerName: "メステート合同会社 うえまつ産業医事務所", // 領収書(適格請求書)の発行者名
  representative: "上松 弘典",
  address: `〒604-8221 ${DOCTOR.officeAddress}`,
  email: "support@mestate.jp",
  invoiceRegistrationNo: "T7130003006446",
} as const;

export const registrationNo = (): string => process.env.INVOICE_REGISTRATION_NO?.trim() || SELLER.invoiceRegistrationNo;
