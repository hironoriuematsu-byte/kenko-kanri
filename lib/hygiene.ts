export const CHECKLIST_TYPES: Record<string, string> = {
  factory: "工場用",
  office: "オフィス用",
};

export const RESULT_LABELS: Record<string, string> = {
  ok: "良",
  ng: "要改善",
  na: "該当なし",
};

export type ChecklistResult = {
  item: string;
  result: "ok" | "ng" | "na";
  note: string;
};

export const DEFAULT_FACTORY_ITEMS = [
  "整理・整頓・清掃・清潔(4S)の状況",
  "通路・非常口の確保、避難経路の表示",
  "機械設備の安全カバー・防護措置",
  "保護具(ヘルメット・手袋・保護メガネ等)の着用状況",
  "化学物質の保管・表示・SDSの整備",
  "温度・湿度・換気の状況",
  "照明の明るさ",
  "騒音・振動の状況",
  "休憩室・トイレ・手洗い場の衛生状態",
  "救急箱・消火器・AEDの設置と点検状況",
];

export const DEFAULT_OFFICE_ITEMS = [
  "整理・整頓・清掃の状況",
  "通路・非常口の確保",
  "VDT作業環境(画面の位置・照明の映り込み・姿勢)",
  "温度・湿度・換気の状況",
  "照明の明るさ",
  "配線の整理(つまずき・転倒防止)",
  "休憩スペース・給湯室の衛生状態",
  "救急箱・消火器の設置と点検状況",
  "受動喫煙防止対策の状況",
  "長時間労働・座りっぱなし対策の状況",
];
