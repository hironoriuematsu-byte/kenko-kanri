// 紹介用デモの架空データ(モデル株式会社)。データベースには一切触れない。
// ストレスチェックWebのデモと同じ会社名・年度にそろえる
import type { CheckupRow } from "@/components/CheckupsTable";
import type { ReportItem } from "@/lib/checkupReport";

export const DEMO_COMPANY = "モデル株式会社";
export const DEMO_FISCAL_YEAR = 2026;
export const DEMO_PHYSICIAN = "上松弘典";
export const DEMO_OFFICE = {
  office_name: "うえまつ産業医事務所",
  address: "京都府京都市中京区錦小路通室町西入天神山町280 石勘株式会社 第一ビル 4F-15",
  tel: null as string | null,
  physician_name: DEMO_PHYSICIAN,
};

type Person = {
  no: string;
  name: string;
  kana: string;
  birth: string;
  sex: "male" | "female";
  dept: string;
  date: string;
  grade: "A" | "B" | "C" | "D";
  // 検査項目: [項目名, 値, 判定]
  items: [string, string, string][];
  judgment?: "normal" | "restricted" | "pending" | null;
  note?: string;
  condition?: "consult" | null;
  followup?: "none" | "pending" | "recommended" | "done";
};

const JUDGED = "2026-09-10";

// 受診者15名(5部署)。有所見率・医師の指示人数などが自然な分布になるように作る
const PEOPLE: Person[] = [
  { no: "1001", name: "青木 誠", kana: "アオキ マコト", birth: "1975-04-12", sex: "male", dept: "製造部", date: "2026-07-14", grade: "D",
    items: [["BMI", "27.8", "C"], ["収縮期血圧", "158", "D"], ["拡張期血圧", "98", "D"], ["血色素量", "15.1", "A"], ["AST", "28", "A"], ["ALT", "41", "B"], ["中性脂肪", "212", "C"], ["LDLコレステロール", "148", "C"], ["HbA1c", "5.7", "B"], ["尿糖", "-", "A"], ["尿蛋白", "-", "A"], ["胸部エックス線", "異常なし", "A"], ["心電図", "異常なし", "A"], ["聴力 1000Hz", "20", "A"], ["聴力 4000Hz", "30", "A"]],
    judgment: "normal", condition: "consult", note: "高血圧あり内科受診。時間外労働月45時間以内", followup: "recommended" },
  { no: "1002", name: "石井 由美", kana: "イシイ ユミ", birth: "1988-11-03", sex: "female", dept: "製造部", date: "2026-07-14", grade: "A",
    items: [["BMI", "21.0", "A"], ["収縮期血圧", "112", "A"], ["拡張期血圧", "70", "A"], ["血色素量", "13.2", "A"], ["AST", "19", "A"], ["ALT", "15", "A"], ["中性脂肪", "78", "A"], ["LDLコレステロール", "102", "A"], ["HbA1c", "5.2", "A"], ["尿糖", "-", "A"], ["尿蛋白", "-", "A"], ["胸部エックス線", "異常なし", "A"], ["心電図", "異常なし", "A"], ["聴力 1000Hz", "15", "A"], ["聴力 4000Hz", "20", "A"]],
    judgment: "normal", followup: "none" },
  { no: "1003", name: "上田 浩二", kana: "ウエダ コウジ", birth: "1969-02-27", sex: "male", dept: "製造部", date: "2026-07-14", grade: "D",
    items: [["BMI", "29.4", "C"], ["収縮期血圧", "146", "C"], ["拡張期血圧", "92", "C"], ["血色素量", "14.8", "A"], ["AST", "52", "C"], ["ALT", "78", "D"], ["中性脂肪", "310", "D"], ["LDLコレステロール", "162", "C"], ["HbA1c", "7.1", "D"], ["尿糖", "+", "C"], ["尿蛋白", "-", "A"], ["胸部エックス線", "異常なし", "A"], ["心電図", "異常なし", "A"], ["聴力 1000Hz", "25", "A"], ["聴力 4000Hz", "45", "C"]],
    judgment: "restricted", note: "要産業医面談 / 時間外労働月45時間以内 / 糖尿病・肝機能障害あり内科受診", followup: "pending" },
  { no: "1004", name: "遠藤 さくら", kana: "エンドウ サクラ", birth: "1992-06-18", sex: "female", dept: "製造部", date: "2026-07-14", grade: "C",
    items: [["BMI", "18.1", "B"], ["収縮期血圧", "104", "A"], ["拡張期血圧", "64", "A"], ["血色素量", "10.9", "C"], ["AST", "17", "A"], ["ALT", "12", "A"], ["中性脂肪", "65", "A"], ["LDLコレステロール", "95", "A"], ["HbA1c", "5.1", "A"], ["尿糖", "-", "A"], ["尿蛋白", "-", "A"], ["胸部エックス線", "異常なし", "A"], ["心電図", "異常なし", "A"], ["聴力 1000Hz", "15", "A"], ["聴力 4000Hz", "15", "A"]],
    judgment: "normal", followup: "none" },
  { no: "1005", name: "大野 健太", kana: "オオノ ケンタ", birth: "1983-09-30", sex: "male", dept: "製造部", date: "2026-07-15", grade: "B",
    items: [["BMI", "24.9", "A"], ["収縮期血圧", "128", "B"], ["拡張期血圧", "82", "B"], ["血色素量", "15.6", "A"], ["AST", "24", "A"], ["ALT", "30", "A"], ["中性脂肪", "140", "A"], ["LDLコレステロール", "118", "A"], ["HbA1c", "5.5", "A"], ["尿糖", "-", "A"], ["尿蛋白", "-", "A"], ["胸部エックス線", "異常なし", "A"], ["心電図", "異常なし", "A"], ["聴力 1000Hz", "20", "A"], ["聴力 4000Hz", "25", "A"]],
    judgment: "normal", followup: "none" },
  { no: "2001", name: "片山 恵", kana: "カタヤマ メグミ", birth: "1979-12-09", sex: "female", dept: "営業部", date: "2026-07-21", grade: "C",
    items: [["BMI", "22.4", "A"], ["収縮期血圧", "118", "A"], ["拡張期血圧", "74", "A"], ["血色素量", "12.6", "A"], ["AST", "21", "A"], ["ALT", "18", "A"], ["中性脂肪", "96", "A"], ["LDLコレステロール", "152", "C"], ["HbA1c", "5.6", "A"], ["尿糖", "-", "A"], ["尿蛋白", "-", "A"], ["胸部エックス線", "異常なし", "A"], ["心電図", "異常なし", "A"], ["聴力 1000Hz", "15", "A"], ["聴力 4000Hz", "20", "A"]],
    judgment: "normal", followup: "none" },
  { no: "2002", name: "木村 大輔", kana: "キムラ ダイスケ", birth: "1986-03-15", sex: "male", dept: "営業部", date: "2026-07-21", grade: "C",
    items: [["BMI", "26.2", "C"], ["収縮期血圧", "134", "B"], ["拡張期血圧", "86", "B"], ["血色素量", "15.0", "A"], ["AST", "33", "B"], ["ALT", "48", "C"], ["中性脂肪", "188", "C"], ["LDLコレステロール", "131", "B"], ["HbA1c", "5.8", "B"], ["尿糖", "-", "A"], ["尿蛋白", "-", "A"], ["胸部エックス線", "異常なし", "A"], ["心電図", "異常なし", "A"], ["聴力 1000Hz", "20", "A"], ["聴力 4000Hz", "30", "A"]],
    judgment: "normal", followup: "none" },
  { no: "2003", name: "小林 直人", kana: "コバヤシ ナオト", birth: "1965-08-22", sex: "male", dept: "営業部", date: "2026-07-21", grade: "D",
    items: [["BMI", "23.5", "A"], ["収縮期血圧", "138", "B"], ["拡張期血圧", "84", "B"], ["血色素量", "14.2", "A"], ["AST", "26", "A"], ["ALT", "22", "A"], ["中性脂肪", "120", "A"], ["LDLコレステロール", "125", "B"], ["HbA1c", "5.6", "A"], ["尿糖", "-", "A"], ["尿蛋白", "-", "A"], ["胸部エックス線", "右上肺野に結節影", "D"], ["心電図", "完全右脚ブロック", "C"], ["聴力 1000Hz", "30", "B"], ["聴力 4000Hz", "50", "C"]],
    judgment: "normal", condition: "consult", note: "胸部エックス線異常あり呼吸器内科受診", followup: "done" },
  { no: "2004", name: "佐藤 美咲", kana: "サトウ ミサキ", birth: "1995-01-07", sex: "female", dept: "営業部", date: "2026-07-22", grade: "A",
    items: [["BMI", "20.3", "A"], ["収縮期血圧", "108", "A"], ["拡張期血圧", "66", "A"], ["血色素量", "12.9", "A"], ["AST", "18", "A"], ["ALT", "14", "A"], ["中性脂肪", "70", "A"], ["LDLコレステロール", "98", "A"], ["HbA1c", "5.0", "A"], ["尿糖", "-", "A"], ["尿蛋白", "-", "A"], ["胸部エックス線", "異常なし", "A"], ["心電図", "異常なし", "A"], ["聴力 1000Hz", "15", "A"], ["聴力 4000Hz", "15", "A"]],
    judgment: "normal", followup: "none" },
  { no: "3001", name: "鈴木 翔太", kana: "スズキ ショウタ", birth: "1990-10-11", sex: "male", dept: "開発部", date: "2026-08-04", grade: "B",
    items: [["BMI", "25.3", "B"], ["収縮期血圧", "122", "A"], ["拡張期血圧", "78", "A"], ["血色素量", "15.3", "A"], ["AST", "22", "A"], ["ALT", "35", "B"], ["中性脂肪", "132", "A"], ["LDLコレステロール", "121", "B"], ["HbA1c", "5.4", "A"], ["尿糖", "-", "A"], ["尿蛋白", "-", "A"], ["胸部エックス線", "異常なし", "A"], ["心電図", "異常なし", "A"], ["聴力 1000Hz", "15", "A"], ["聴力 4000Hz", "20", "A"]],
    judgment: "normal", followup: "none" },
  { no: "3002", name: "高橋 玲奈", kana: "タカハシ レイナ", birth: "1984-05-25", sex: "female", dept: "開発部", date: "2026-08-04", grade: "C",
    items: [["BMI", "19.6", "A"], ["収縮期血圧", "110", "A"], ["拡張期血圧", "68", "A"], ["血色素量", "11.4", "C"], ["AST", "20", "A"], ["ALT", "16", "A"], ["中性脂肪", "82", "A"], ["LDLコレステロール", "110", "A"], ["HbA1c", "5.3", "A"], ["尿糖", "-", "A"], ["尿蛋白", "±", "B"], ["胸部エックス線", "異常なし", "A"], ["心電図", "異常なし", "A"], ["聴力 1000Hz", "15", "A"], ["聴力 4000Hz", "15", "A"]],
    judgment: "normal", followup: "none" },
  { no: "3003", name: "田村 雄一", kana: "タムラ ユウイチ", birth: "1972-07-02", sex: "male", dept: "開発部", date: "2026-08-05", grade: "D",
    items: [["BMI", "31.2", "D"], ["収縮期血圧", "162", "D"], ["拡張期血圧", "104", "D"], ["血色素量", "16.0", "A"], ["AST", "38", "B"], ["ALT", "55", "C"], ["中性脂肪", "265", "C"], ["LDLコレステロール", "171", "D"], ["HbA1c", "6.4", "C"], ["尿糖", "-", "A"], ["尿蛋白", "+", "C"], ["胸部エックス線", "異常なし", "A"], ["心電図", "左室肥大", "C"], ["聴力 1000Hz", "20", "A"], ["聴力 4000Hz", "35", "B"]],
    judgment: "pending", note: "血圧の再測定と内科受診の結果を確認してから判定", followup: "pending" },
  { no: "4001", name: "中村 彩", kana: "ナカムラ アヤ", birth: "1998-02-14", sex: "female", dept: "管理部", date: "2026-08-18", grade: "A",
    items: [["BMI", "21.8", "A"], ["収縮期血圧", "106", "A"], ["拡張期血圧", "64", "A"], ["血色素量", "13.0", "A"], ["AST", "17", "A"], ["ALT", "13", "A"], ["中性脂肪", "60", "A"], ["LDLコレステロール", "92", "A"], ["HbA1c", "5.1", "A"], ["尿糖", "-", "A"], ["尿蛋白", "-", "A"], ["胸部エックス線", "異常なし", "A"], ["心電図", "異常なし", "A"], ["聴力 1000Hz", "15", "A"], ["聴力 4000Hz", "15", "A"]],
    judgment: "normal", followup: "none" },
  { no: "4002", name: "西田 修", kana: "ニシダ オサム", birth: "1977-11-29", sex: "male", dept: "管理部", date: "2026-08-18", grade: "C",
    items: [["BMI", "24.1", "A"], ["収縮期血圧", "130", "B"], ["拡張期血圧", "80", "A"], ["血色素量", "14.9", "A"], ["AST", "30", "B"], ["ALT", "44", "C"], ["中性脂肪", "165", "B"], ["LDLコレステロール", "141", "C"], ["HbA1c", "5.9", "B"], ["尿糖", "-", "A"], ["尿蛋白", "-", "A"], ["胸部エックス線", "異常なし", "A"], ["心電図", "異常なし", "A"], ["聴力 1000Hz", "20", "A"], ["聴力 4000Hz", "30", "A"]],
    judgment: "normal", followup: "none" },
  { no: "5001", name: "林 真理子", kana: "ハヤシ マリコ", birth: "1981-04-05", sex: "female", dept: "品質保証部", date: "2026-08-25", grade: "D",
    items: [["BMI", "23.0", "A"], ["収縮期血圧", "116", "A"], ["拡張期血圧", "72", "A"], ["血色素量", "9.4", "D"], ["AST", "19", "A"], ["ALT", "15", "A"], ["中性脂肪", "88", "A"], ["LDLコレステロール", "112", "A"], ["HbA1c", "5.3", "A"], ["尿糖", "-", "A"], ["尿蛋白", "-", "A"], ["胸部エックス線", "異常なし", "A"], ["心電図", "異常なし", "A"], ["聴力 1000Hz", "15", "A"], ["聴力 4000Hz", "20", "A"]],
    judgment: "normal", condition: "consult", note: "貧血あり内科（婦人科）受診", followup: "recommended" },
];


// 上の15名(個別に意味のある例)に加えて、50名規模の事業場に見えるよう35名を規則的に生成する。
// 乱数は固定の種で作るため、表示のたびに内容が変わることはない
const SURNAMES = ["伊藤", "渡辺", "山本", "松本", "井上", "清水", "山田", "斎藤", "加藤", "吉田", "山口", "森", "池田", "橋本", "阿部", "石川", "山崎", "中島", "前田", "藤田", "岡田", "後藤", "長谷川", "村上", "近藤", "石田", "坂本", "遠山", "藤井", "三浦", "福田", "太田", "岡本", "松田", "中野"];
const SURNAME_KANA = ["イトウ", "ワタナベ", "ヤマモト", "マツモト", "イノウエ", "シミズ", "ヤマダ", "サイトウ", "カトウ", "ヨシダ", "ヤマグチ", "モリ", "イケダ", "ハシモト", "アベ", "イシカワ", "ヤマザキ", "ナカジマ", "マエダ", "フジタ", "オカダ", "ゴトウ", "ハセガワ", "ムラカミ", "コンドウ", "イシダ", "サカモト", "トオヤマ", "フジイ", "ミウラ", "フクダ", "オオタ", "オカモト", "マツダ", "ナカノ"];
const GIVEN_M: [string, string][] = [["拓也", "タクヤ"], ["智也", "トモヤ"], ["亮", "リョウ"], ["達也", "タツヤ"], ["正人", "マサト"], ["裕介", "ユウスケ"], ["和也", "カズヤ"], ["隆", "タカシ"], ["健", "ケン"], ["勇気", "ユウキ"], ["博", "ヒロシ"], ["聡", "サトシ"], ["慎一", "シンイチ"], ["学", "マナブ"], ["良太", "リョウタ"], ["洋平", "ヨウヘイ"], ["大樹", "ダイキ"], ["昌也", "マサヤ"]];
const GIVEN_F: [string, string][] = [["美穂", "ミホ"], ["愛", "アイ"], ["明日香", "アスカ"], ["智子", "トモコ"], ["裕子", "ユウコ"], ["麻衣", "マイ"], ["奈々", "ナナ"], ["恵美", "エミ"], ["舞", "マイ"], ["千尋", "チヒロ"], ["香織", "カオリ"], ["里奈", "リナ"], ["春香", "ハルカ"], ["優子", "ユウコ"], ["真由", "マユ"], ["結衣", "ユイ"], ["沙織", "サオリ"]];
const DEPTS: [string, string][] = [["製造部", "1"], ["営業部", "2"], ["開発部", "3"], ["管理部", "4"], ["品質保証部", "5"]];

function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

function generatedPeople(count: number): Person[] {
  const r = rng(20260701);
  const out: Person[] = [];
  const perDept: Record<string, number> = { "1": 5, "2": 4, "3": 3, "4": 2, "5": 1 }; // 既存15名の社員番号の続き
  for (let i = 0; i < count; i++) {
    const [dept, code] = DEPTS[i % DEPTS.length];
    const male = r() < 0.6;
    const sur = SURNAMES[i % SURNAMES.length];
    const surK = SURNAME_KANA[i % SURNAME_KANA.length];
    const [given, givenK] = male ? GIVEN_M[i % GIVEN_M.length] : GIVEN_F[i % GIVEN_F.length];
    const age = 22 + Math.floor(r() * 40);
    const birthY = 2026 - age;
    const birth = `${birthY}-${String(1 + Math.floor(r() * 12)).padStart(2, "0")}-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}`;
    perDept[code] += 1;
    const no = `${code}${String(perDept[code]).padStart(3, "0")}`;
    const date = `2026-${["07", "07", "08", "08"][i % 4]}-${String(14 + (i % 12)).padStart(2, "0")}`;

    // 年齢が高いほど異常が出やすい簡単なモデル
    const risk = (age - 22) / 40;
    const g = (ok: number, mild: number, hi: number) => {
      const v = r();
      if (v < ok - risk * 0.3) return "A";
      if (v < ok + mild) return "B";
      if (v < ok + mild + hi) return "C";
      return "D";
    };
    const bmiV = 19 + r() * 7.5 + risk * 2.5;
    const sbpV = Math.round(104 + r() * 30 + risk * 30);
    const dbpV = Math.round(62 + r() * 18 + risk * 18);
    const hbV = male ? 13.5 + r() * 3 : 11.2 + r() * 2.6;
    const astV = Math.round(16 + r() * 18 + risk * 12);
    const altV = Math.round(12 + r() * 20 + risk * 16);
    const tgV = Math.round(60 + r() * 90 + risk * 70);
    const ldlV = Math.round(88 + r() * 45 + risk * 25);
    const a1cV = 5.0 + r() * 0.6 + risk * 0.5;
    const grade = (v: number, b: number, c: number, d: number) => (v >= d ? "D" : v >= c ? "C" : v >= b ? "B" : "A");
    const items: [string, string, string][] = [
      ["BMI", bmiV.toFixed(1), grade(bmiV, 25, 27, 30)],
      ["収縮期血圧", String(sbpV), grade(sbpV, 130, 140, 160)],
      ["拡張期血圧", String(dbpV), grade(dbpV, 85, 90, 100)],
      ["血色素量", hbV.toFixed(1), hbV < (male ? 12.0 : 10.0) ? "D" : hbV < (male ? 13.0 : 11.5) ? "C" : "A"],
      ["AST", String(astV), grade(astV, 31, 36, 51)],
      ["ALT", String(altV), grade(altV, 31, 41, 61)],
      ["中性脂肪", String(tgV), grade(tgV, 150, 200, 300)],
      ["LDLコレステロール", String(ldlV), grade(ldlV, 120, 140, 180)],
      ["HbA1c", a1cV.toFixed(1), grade(a1cV, 5.6, 6.0, 6.5)],
      ["尿糖", "-", "A"],
      ["尿蛋白", r() < 0.06 ? "±" : "-", "A"],
      ["胸部エックス線", "異常なし", "A"],
      ["心電図", "異常なし", g(0.9, 0.05, 0.05)],
      ["聴力 1000Hz", String(15 + Math.floor(r() * 3) * 5), "A"],
      ["聴力 4000Hz", String(15 + Math.floor(r() * 4 + risk * 3) * 5), risk > 0.7 && r() < 0.3 ? "C" : "A"],
    ];
    const order = ["A", "B", "C", "D"];
    const overall = items.reduce<string>((m, it) => (order.indexOf(it[2]) > order.indexOf(m) ? it[2] : m), "A") as Person["grade"];
    const severe = overall === "D";
    const followupRoll = r();
    out.push({
      no, name: `${sur} ${given}`, kana: `${surK} ${givenK}`, birth, sex: male ? "male" : "female", dept, date, grade: overall, items,
      judgment: "normal",
      condition: severe ? "consult" : null,
      note: severe ? "要医療項目あり内科受診" : undefined,
      followup: severe ? (followupRoll < 0.5 ? "pending" : followupRoll < 0.8 ? "recommended" : "done") : "none",
    });
  }
  return out;
}

const ALL_PEOPLE: Person[] = [...PEOPLE, ...generatedPeople(35)].sort((a, b) => a.no.localeCompare(b.no));

const id = (i: number) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;

export function demoCheckups(): { rows: CheckupRow[]; items: ReportItem[] } {
  const rows: CheckupRow[] = [];
  const items: ReportItem[] = [];
  ALL_PEOPLE.forEach((p, i) => {
    const cid = id(i);
    p.items.forEach(([name, value, judgment]) => items.push({ checkup_id: cid, item_name: name, value, judgment }));
    rows.push({
      id: cid,
      target_name: p.name,
      target_name_kana: p.kana,
      department: p.dept,
      birth_date: p.birth,
      employee_no: p.no,
      sex: p.sex,
      checkup_type: "regular",
      checkup_date: p.date,
      overall_judgment: p.grade,
      has_findings: /^[CD]/.test(p.grade) || p.items.some(([, , j]) => /^[CDER]/.test(j)),
      work_judgment: p.judgment ?? null,
      work_judgment_note: p.note ?? null,
      work_judgment_date: p.judgment ? JUDGED : null,
      work_judgment_condition: p.condition ?? null,
      followup_status: p.followup ?? "none",
      findingItems: p.items.filter(([, , j]) => /^[CDER]/.test(j)).map(([name, , j]) => ({ item_name: name, judgment: j })),
    });
  });
  return { rows, items };
}

// 産業医面談(4件)
export type DemoInterview = {
  id: string;
  target_name: string;
  interview_type: string;
  scheduled_at: string;
  method: string;
  location: string;
  status: "scheduled" | "done";
  pre_info: string;
  record?: { conducted_date: string; notes: string };
  opinion?: { interview_date: string; work_judgment: "normal" | "restricted" | "leave"; opinion: string; issued_date: string; published: boolean };
};

export const DEMO_INTERVIEWS: DemoInterview[] = [
  {
    id: "i1",
    target_name: "上田 浩二",
    interview_type: "checkup_followup",
    scheduled_at: "2026-09-16T03:00:00.000Z",
    method: "in_person",
    location: "本社 3F 相談室",
    status: "done",
    pre_info: "直近3か月の時間外労働: 38・42・35時間。健診で糖尿病・肝機能の要医療判定。夜勤は月4回。本人は受診にやや消極的。",
    record: {
      conducted_date: "2026-09-16",
      notes: "HbA1c 7.1、ALT 78。自覚症状なし。飲酒は毎日ビール500ml×2。受診の必要性を説明し、かかりつけ内科への受診を約束。夜勤は当面継続可だが、血糖コントロールが付くまで時間外労働は月45時間以内とする。3か月後に再面談。",
    },
    opinion: {
      interview_date: "2026-09-16",
      work_judgment: "restricted",
      opinion: "時間外労働は月45時間以内としてください。深夜業は現状の月4回までとし、増やさないでください。医療機関の受診結果を確認のうえ、3か月後に再面談を行います。",
      issued_date: "2026-09-16",
      published: true,
    },
  },
  {
    id: "i2",
    target_name: "田村 雄一",
    interview_type: "checkup_followup",
    scheduled_at: "2026-10-07T01:00:00.000Z",
    method: "online",
    location: "Teams（会議URLは別途送付）",
    status: "scheduled",
    pre_info: "健診で血圧 162/104、LDL 171。本人は「職場で測ると高くなる」と話している。家庭血圧の記録を持参予定。",
  },
  {
    id: "i3",
    target_name: "岡本 隆",
    interview_type: "high_stress",
    scheduled_at: "2026-09-29T05:00:00.000Z",
    method: "in_person",
    location: "本社 3F 相談室",
    status: "done",
    pre_info: "ストレスチェックで高ストレス判定、本人から面接指導の申出。プロジェクトの納期前で時間外労働が月60時間を超えた月あり。",
    record: {
      conducted_date: "2026-09-29",
      notes: "睡眠時間5時間程度、中途覚醒あり。食欲低下は軽度。抑うつ気分は否定。業務量の偏りが主因。上司との面談を本人が希望。",
    },
    opinion: {
      interview_date: "2026-09-29",
      work_judgment: "normal",
      opinion: "通常勤務は可能です。時間外労働は当面月45時間以内とし、業務量の調整について上司と本人で面談の機会を設けてください。1か月後に状況を確認します。",
      issued_date: "2026-09-29",
      published: true,
    },
  },
  {
    id: "i4",
    target_name: "森田 恵子",
    interview_type: "return_to_work",
    scheduled_at: "2026-10-14T02:00:00.000Z",
    method: "in_person",
    location: "本社 3F 相談室",
    status: "scheduled",
    pre_info: "主治医の復職可の診断書あり（10/20から）。本人は時短勤務での復帰を希望。",
  },
];

export function demoInterview(id: string): DemoInterview | undefined {
  return DEMO_INTERVIEWS.find((i) => i.id === id);
}

// 個人カルテのサンプル(上田 浩二)
export const DEMO_KARTE = {
  full_name: "上田 浩二",
  kana: "ウエダ コウジ",
  employee_no: "1003",
  birth_date: "1969-02-27",
  department: "製造部",
  note: "夜勤あり（月4回）。2024年に高血圧で内科通院歴",
  checkups: [
    { fiscal_year: 2026, checkup_type: "regular", checkup_date: "2026-07-14", overall_judgment: "D", work_judgment: "restricted" },
    { fiscal_year: 2025, checkup_type: "regular", checkup_date: "2025-07-10", overall_judgment: "C", work_judgment: "normal" },
    { fiscal_year: 2024, checkup_type: "regular", checkup_date: "2024-07-12", overall_judgment: "C", work_judgment: "normal" },
  ],
  interviews: [
    { id: "i1", interview_type: "checkup_followup", scheduled_at: "2026-09-16T03:00:00.000Z", status: "done" },
    { id: "i0", interview_type: "checkup_followup", scheduled_at: "2025-09-18T03:00:00.000Z", status: "done" },
  ],
  documents: [
    { doc_type: "referral_request", title: "診療情報提供依頼書", addressee: "○○内科クリニック 御中", issued_date: "2026-09-16", visibility: "shared" },
  ],
  files: [
    { category: "medical_certificate", file_name: "診断書_2026-09.pdf", note: "内科（糖尿病）", visibility: "shared", created_at: "2026-09-25" },
  ],
};
