// 所見の文言から判定する項目(心電図・胸部エックス線・聴力の定性記載)。
// 数値の基準ではなく、記載された所見の語句で A〜D を決める。
//
// 心電図: 日本人間ドック学会「心電図健診判定マニュアル」(平成26年4月)の
//         表2「所見と判定区分」に沿う。D1・D2 は D にまとめる。
//         同じ所見で C/D2 と幅のあるものは C とする(症状の有無で判定医が変更)。
// 胸部X線: 所見があれば B。そのうち精査を要する語句(腫瘤・結節 など)を含めば D。

import type { Grade } from "@/lib/judgment";

// 表記ゆれを吸収する(全角→半角、大文字→小文字、空白・記号の除去)
export function normalizeFinding(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　,、，.。()（）\[\]【】:：;；/／・\-－ー'’"]/g, "");
}

// 「異常なし」に相当する語句(これしか含まれなければ A)
const NORMAL_WORDS = [
  "異常なし", "異常認めず", "異常を認めず", "異常ありません", "異常所見なし", "異常所見を認めず",
  "所見なし", "所見無し", "特記事項なし", "特記なし", "特記すべき所見なし", "特になし", "特に",
  "問題なし", "正常範囲内", "正常範囲", "正常心電図", "正常洞調律", "正常", "洞調律",
  "wnl", "normal", "nil", "変化なし", "前回と変化なし", "n.p", "np",
];

export function isNormalFinding(text: string): boolean {
  const t = normalizeFinding(text);
  if (t === "" || t === "-" || t === "—") return true;
  // 「異常なし」系の語句を取り除いて、何も残らなければ正常
  let rest = t;
  for (const w of NORMAL_WORDS.map(normalizeFinding).sort((a, b) => b.length - a.length)) {
    rest = rest.split(w).join("");
  }
  return rest.replace(/[a-z0-9]/g, "") === "" && !/[^\x00-\x7f]/.test(rest);
}

type Keyword = { word: string; grade: Exclude<Grade, "A" | "R"> };

// ------------------------------------------------------------
// 心電図(人間ドック学会マニュアル 表2)。長い語句から順に照合する
// ------------------------------------------------------------
export const ECG_KEYWORDS: Keyword[] = [
  // --- D(D1・D2) ---
  { word: "完全右脚ブロック+左脚前枝ブロック", grade: "D" },
  { word: "完全右脚ブロック+左脚後枝ブロック", grade: "D" },
  { word: "完全右脚ブロック左脚前枝ブロック", grade: "D" },
  { word: "二枝ブロック", grade: "D" },
  { word: "三枝ブロック", grade: "D" },
  { word: "間欠性完全左脚ブロック", grade: "D" },
  { word: "完全左脚ブロック", grade: "D" },
  { word: "心室内ブロック", grade: "D" },
  { word: "完全房室ブロック", grade: "D" },
  { word: "iii度房室ブロック", grade: "D" },
  { word: "3度房室ブロック", grade: "D" },
  { word: "高度房室ブロック", grade: "D" },
  { word: "mobitz", grade: "D" },
  { word: "モビッツ", grade: "D" },
  { word: "2:1房室ブロック", grade: "D" },
  { word: "21房室ブロック", grade: "D" },
  { word: "r波増高不良", grade: "D" },
  { word: "異常q波", grade: "D" },
  { word: "両室高電位", grade: "D" },
  { word: "両室肥大", grade: "D" },
  { word: "ブルガダ", grade: "D" },
  { word: "brugada", grade: "D" },
  { word: "陰性u波", grade: "D" },
  { word: "洞頻脈", grade: "D" },
  { word: "洞性頻脈", grade: "D" },
  { word: "多形性上室期外収縮", grade: "D" },
  { word: "連発性上室期外収縮", grade: "D" },
  { word: "多源性心室期外収縮", grade: "D" },
  { word: "多形性心室期外収縮", grade: "D" },
  { word: "連発性心室期外収縮", grade: "D" },
  { word: "上室頻拍", grade: "D" },
  { word: "発作性上室頻拍", grade: "D" },
  { word: "心房細動", grade: "D" },
  { word: "心房粗動", grade: "D" },
  { word: "心室細動", grade: "D" },
  { word: "心室頻拍", grade: "D" },
  { word: "房室解離", grade: "D" },
  { word: "洞房ブロック", grade: "D" },
  { word: "洞停止", grade: "D" },
  { word: "洞不全", grade: "D" },
  { word: "心筋梗塞", grade: "D" },
  { word: "梗塞", grade: "D" },
  { word: "虚血", grade: "D" },
  // ST-T低下は、「疑い」「上行傾斜」「u字」でなければ D
  { word: "st-t低下", grade: "D" },
  { word: "stt低下", grade: "D" },
  { word: "st低下", grade: "D" },
  { word: "st下降", grade: "D" },
  { word: "st-t異常", grade: "D" },
  { word: "stt異常", grade: "D" },
  { word: "st異常", grade: "D" },
  // --- C ---
  { word: "st-t低下の疑い", grade: "C" },
  { word: "stt低下の疑い", grade: "C" },
  { word: "st低下の疑い", grade: "C" },
  { word: "上行傾斜", grade: "C" },
  { word: "u字型", grade: "C" },
  { word: "境界域q波", grade: "C" },
  { word: "境界域のq波", grade: "C" },
  { word: "q波", grade: "C" },
  { word: "右室高電位", grade: "C" },
  { word: "右室肥大", grade: "C" },
  { word: "左室高電位", grade: "C" },
  { word: "左室肥大", grade: "C" },
  { word: "高電位", grade: "C" },
  { word: "早期再分極", grade: "C" },
  { word: "st上昇", grade: "C" },
  { word: "平低t", grade: "C" },
  { word: "平坦t", grade: "C" },
  { word: "二相性t", grade: "C" },
  { word: "陰性t", grade: "C" },
  { word: "t波異常", grade: "C" },
  { word: "t波陰性", grade: "C" },
  { word: "t波平低", grade: "C" },
  { word: "pq短縮", grade: "C" },
  { word: "pr短縮", grade: "C" },
  { word: "i度房室ブロック", grade: "C" },
  { word: "1度房室ブロック", grade: "C" },
  { word: "第1度房室ブロック", grade: "C" },
  { word: "pq延長", grade: "C" },
  { word: "pr延長", grade: "C" },
  { word: "wenckebach", grade: "C" },
  { word: "ウェンケバッハ", grade: "C" },
  { word: "ii度房室ブロック", grade: "C" },
  { word: "2度房室ブロック", grade: "C" },
  { word: "wpw", grade: "C" },
  { word: "早期興奮", grade: "C" },
  { word: "間欠性完全右脚ブロック", grade: "C" },
  { word: "完全右脚ブロック", grade: "C" },
  { word: "左脚前枝ブロック", grade: "C" },
  { word: "左脚後枝ブロック", grade: "C" },
  { word: "心拍過多", grade: "C" },
  { word: "頻発", grade: "C" },
  { word: "持続性上室調律", grade: "C" },
  { word: "冠状静脈洞調律", grade: "C" },
  { word: "確定できない不整脈", grade: "C" },
  { word: "qt延長", grade: "C" },
  { word: "qtc延長", grade: "C" },
  { word: "qt短縮", grade: "C" },
  { word: "洞徐脈", grade: "C" },
  { word: "洞性徐脈", grade: "C" },
  { word: "徐脈", grade: "C" },
  { word: "頻脈", grade: "C" },
  { word: "不整脈", grade: "C" },
  { word: "ブロック", grade: "C" },
  // --- B ---
  { word: "軽度な右軸偏位", grade: "B" },
  { word: "右軸偏位", grade: "B" },
  { word: "左軸偏位", grade: "B" },
  { word: "極端な軸偏位", grade: "B" },
  { word: "軸偏位", grade: "B" },
  { word: "不定軸", grade: "B" },
  { word: "rsr", grade: "B" },
  { word: "不完全右脚ブロック", grade: "B" },
  { word: "不完全左脚ブロック", grade: "B" },
  { word: "間欠性房室変行伝導", grade: "B" },
  { word: "変行伝導", grade: "B" },
  { word: "洞性不整脈", grade: "B" },
  { word: "呼吸性不整脈", grade: "B" },
  { word: "上室期外収縮", grade: "B" },
  { word: "上室性期外収縮", grade: "B" },
  { word: "心房期外収縮", grade: "B" },
  { word: "心室期外収縮", grade: "B" },
  { word: "心室性期外収縮", grade: "B" },
  { word: "期外収縮", grade: "B" },
  { word: "低電位差", grade: "B" },
  { word: "低電位", grade: "B" },
  { word: "右胸心", grade: "B" },
  { word: "右房性p波", grade: "B" },
  { word: "左房性p波", grade: "B" },
  { word: "右房負荷", grade: "B" },
  { word: "左房負荷", grade: "B" },
  { word: "高いt波", grade: "B" },
  { word: "高t波", grade: "B" },
  { word: "t波増高", grade: "B" },
  { word: "時計方向回転", grade: "B" },
  { word: "反時計方向回転", grade: "B" },
  { word: "移行帯", grade: "B" },
  // --- E(治療中) ---
  { word: "ペースメーカ", grade: "E" },
  { word: "pacemaker", grade: "E" },
];

const RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };

// 語句表に沿って判定する。該当する語句のうち最も重い判定を返す
function judgeByKeywords(text: string, keywords: Keyword[], fallback: Grade): Grade {
  const t = normalizeFinding(text);
  let worst: Grade | null = null;
  const sorted = [...keywords].sort((a, b) => b.word.length - a.word.length);
  let rest = t;
  for (const k of sorted) {
    const w = normalizeFinding(k.word);
    if (w && rest.includes(w)) {
      if (!worst || RANK[k.grade] > RANK[worst]) worst = k.grade;
      // 一致した語句は取り除き、部分語(例: 「不完全右脚ブロック」の中の「ブロック」)で
      // 重い判定に誤って倒れないようにする
      rest = rest.split(w).join("");
    }
  }
  return worst ?? fallback;
}

// 心電図: 正常なら A、語句表に一致すればその判定、
// 所見の記載があるが表にない語句だけなら C(要確認)
export function judgeEcgText(text: string): Grade | null {
  if (text == null) return null;
  if (isNormalFinding(text)) return "A";
  // 左室高電位は ST-T 変化や T 波異常を伴えば D2(マニュアル注2)
  const t = normalizeFinding(text);
  const lvh = /左室高電位|左室肥大/.test(t);
  const stt = /st|t波|陰性t|平低t/.test(t);
  const g = judgeByKeywords(text, ECG_KEYWORDS, "C");
  if (lvh && stt && RANK[g] < RANK.D) return "D";
  return g;
}

// ------------------------------------------------------------
// 胸部エックス線: 所見があれば B。次の語句を含めば D(精査を要する所見)
//   部分一致のため「右胸水」「腹部大動脈瘤」「肺気腫」なども該当する
// ------------------------------------------------------------
//   「肺がん疑い」は「がん」、「腹部大動脈瘤」は「動脈瘤」として D になる
export const CHEST_XRAY_D_WORDS = [
  "腫瘍", "腫瘤", "結節", "空洞", "粒状", "網状", "すりガラス", "スリガラス", "胸水",
  "狭窄", "動脈瘤", "蜂巣", "蜂窩", "気腫", "うっ血", "鬱血", "リンパ節腫",
  "縦郭拡大", "縦隔拡大", "浸潤", "コンソリデーション", "consolidation",
  "胸膜肥厚", "胸膜プラーク", "破壊", "溶骨", "骨折", "心拡大",
  "癌", "がん", "ガン", "転移", "結核", "無気肺", "肺炎", "胸膜炎",
];

// 「陳旧性」の所見は治癒後の変化のため、D の語句を含んでいても B とする
//   (例: 陳旧性肺結核 → B、陳旧性炎症性変化 → B)
const OLD_CHANGE_WORDS = ["陳旧性", "陳旧"];

// 所見は「、」「・」「/」「;」改行などで区切られていることが多いので、区切りごとに判定する。
// 「陳旧性肺結核、右胸水」のような場合は、陳旧性の部分は B、胸水の部分は D になり、全体では D
function splitChestXrayFindings(text: string): string[] {
  return text
    .normalize("NFKC")
    .split(/[\n\r,、，;；/／・]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function isOldChange(segment: string): boolean {
  const t = normalizeFinding(segment);
  return OLD_CHANGE_WORDS.some((w) => t.includes(normalizeFinding(w)));
}

function hasDWord(segment: string): boolean {
  const t = normalizeFinding(segment);
  return CHEST_XRAY_D_WORDS.some((w) => t.includes(normalizeFinding(w)));
}

export function judgeChestXrayText(text: string): Grade | null {
  if (text == null) return null;
  if (isNormalFinding(text)) return "A";
  let worst: Grade = "B";
  for (const seg of splitChestXrayFindings(text)) {
    if (isNormalFinding(seg)) continue;
    if (isOldChange(seg)) continue; // 陳旧性は B
    if (hasDWord(seg)) worst = "D";
  }
  return worst;
}

// 胸部X線で D とした根拠の語句(画面表示用)。陳旧性の部分は除く
export function chestXrayDWords(text: string): string[] {
  const segs = splitChestXrayFindings(text).filter((s) => !isOldChange(s));
  const t = normalizeFinding(segs.join("、"));
  return CHEST_XRAY_D_WORDS.filter((w) => t.includes(normalizeFinding(w)));
}

// ------------------------------------------------------------
// 聴力が「所見なし」「所見あり」のように文字で記載されている場合
// ------------------------------------------------------------
export function judgeHearingText(text: string): Grade | null {
  if (text == null) return null;
  if (isNormalFinding(text)) return "A";
  const t = normalizeFinding(text);
  if (/難聴|要精査|要精密|異常|所見あり|所見有|低下/.test(t)) return "C";
  return null; // 判断できない記載は判定しない
}
