// 健診結果の表(CSVの見出しとデータ行)から、取込用の行(氏名・検査項目・事務所基準の判定)を作る。
// 手で列を指定する取込画面(components/CheckupImport.tsx)と、AIによる自動の読み取り(lib/autoRead*)で同じ処理を使う

import { normalizeGradeText, splitValueGrade, splitDistribution } from "@/lib/gradeText";
import { normalizeDate } from "@/lib/checkups";
import { matchPerson, type PersonCandidate } from "@/lib/personMatch";
import { averageBloodPressure, isAverageHeader } from "@/lib/bloodPressure";
import { findLegalItemByHeader, judgeItem, overallGrade, splitBloodPressure, worstGrade, type Grade, type JudgmentRule } from "@/lib/judgment";
import { markReferral, needsReferral } from "@/lib/referral";

// 列の扱い: 法定項目(自動判定) / 値のみ / 判定として取込 / 取り込まない
export type ColumnMode =
  | { kind: "legal"; itemKey: string }
  | { kind: "value" }
  | { kind: "judgment" }
  | { kind: "distribution" } // 生物学的モニタリングの分布区分(1〜3 → A〜C)
  | { kind: "off" };

// 氏名・生年月日などの列の位置(-1 は「なし」)
export type BaseCols = {
  nameCol: number;
  kanaCol: number;
  deptCol: number;
  empNoCol: number;
  sexCol: number;
  birthCol: number;
  dateCol: number;
  judgmentCol: number;
};

export type ImportItem = { name: string; value?: string; judgment?: string };
export type ImportRow = {
  target_name: string;
  target_name_kana: string;
  department: string;
  employee_no: string;
  sex: string;
  birth_date: string;
  person_id: string;
  target_user_id: string;
  checkup_date: string | null;
  overall_judgment: string;
  // 受診勧奨の対象か(総合判定が要医療(D)以上で、受診勧奨の基準(事務所の基準)に届いている項目がある)
  needs_followup: boolean;
  items: ImportItem[];
  // 1つのファイルに複数の種類の健診が入っているとき、この行をどの健診種別・特殊健診の種類として登録するか
  // (無ければ、ファイルを送るときに選んだ種別・種類)
  checkup_type?: string;
  special_kind?: string | null;
};

// 見出しから列を自動で割り当てる
export function guessColumns(header: string[]): { base: BaseCols; colModes: Record<number, ColumnMode> } {
  const h = header;
  const find = (words: string[], exclude?: RegExp) =>
    h.findIndex((c) => {
      const s = c.replace(/\s/g, "").normalize("NFKC");
      if (exclude && exclude.test(s)) return false;
      return words.some((w) => s.includes(w));
    });
  // 氏名は漢字の列を優先し、カナの列(氏名カナ・フリガナ)は「フリガナ」として別に取り込む
  const isKana = /カナ|かな|ｶﾅ|フリガナ|ふりがな|ﾌﾘｶﾞﾅ|kana/i;
  // 「氏名コード」「氏名番号」のような番号の列は氏名ではない(「氏名漢字」より左にあっても選ばない)
  const isCode = /コード|code|番号|no\.?$|cd$|id$/i;
  const nameIdx = find(["氏名", "名前", "社員名", "受診者名"], new RegExp(`${isKana.source}|${isCode.source}`, "i"));
  const kanaIdx = find(["フリガナ", "ふりがな", "ﾌﾘｶﾞﾅ", "氏名カナ", "氏名かな", "カナ氏名", "かな氏名", "カナ", "かな", "ｶﾅ"]);
  // 漢字の氏名列が無ければ、カナの列を氏名として使う
  const nameCol = nameIdx >= 0 ? nameIdx : kanaIdx;
  const kanaCol = nameIdx >= 0 ? kanaIdx : -1;
  // 所属は名称の列を優先する(「所属コード」と「所属名称」が両方あるCSVでは、名称を使う)
  const deptWords = ["所属", "部署", "部門", "部課", "職場"];
  const deptNamed = find(deptWords, isCode);
  const deptCol = deptNamed >= 0 ? deptNamed : find(deptWords);
  const empNoCol = (find(["社員番号", "社員No", "社員コード", "社員CD", "従業員番号", "従業員コード", "職員番号", "職員コード"]));
  const sexCol = (find(["性別", "性"]));
  const birthCol = (find(["生年月日", "生年", "誕生日", "birth"]));
  // 健診日の列: 健診機関ごとに見出しが異なる(健診年月日・受診年月日・検診日・健康診断日 など)。
  // 「生年月日」「判定日」などの日付は除く
  const dateCol = (
    find(
      [
        "健診日",
        "健診年月日",
        "健診実施日",
        "受診日",
        "受診年月日",
        "受検日",
        "検診日",
        "検診年月日",
        "健康診断日",
        "健康診断年月日",
        "健康診断実施日",
        "実施日",
        "実施年月日",
        "検査日",
        "検査年月日",
        "診察日",
        "測定日",
      ],
      /生年|誕生|判定日|作成日|発行日|入社|退職/
    )
  );
  const judgmentCol = (find(["総合判定", "総合", "判定区分"]));
  // 見出しから法定項目を自動推定。法定項目(自動判定)以外の列はすべて「取り込まない」を既定にし、
  // 必要な列だけを実施者が「判定として取込」「値のみ取込」に切り替える
  // (見出しに「判定」を含む列も既定では取り込まない)
  const init: Record<number, ColumnMode> = {};
  h.forEach((c, i) => {
    const head = c.normalize("NFKC").trim();
    const key = findLegalItemByHeader(c);
    // 「判定」を含む列、「判」で始まる列(例: 判定 血圧、判 HbA1c)は、法定項目の語が続いても取り込まない
    // 特殊健診の労基署報告(様式第3号・第3号の2)の集計に使う列は「値のみ取込」を既定にする:
    //   作業条件(作業時間・作業日数・保護具・換気装置・工程変更・取扱量・大量ばく露)、業務名番号、有機溶剤名番号、
    //   眼底検査、物質コード・特定化学物質・業務内容・業務歴・有所見項目、物質ごとの「判定」(見出しがちょうど「判定」)
    const SPECIAL_VALUE =
      /作業時間|作業日数|保護具|換気|工程変更|取扱量|ばく露|暴露|業務名番号|業務名\(番号\)|有機溶剤名|有機溶剤コード|眼底|物質コード|^特定化学物質$|業務内容|業務歴|有所見項目|有機既往歴|有機業務の経歴|区分$/;
    // 「健診区分」「受診区分」は健診の種類を表す番号で、検査の結果ではない
    if (/^(健診|受診|検診)区分$/.test(head)) init[i] = { kind: "off" };
    else if (head === "判定" || SPECIAL_VALUE.test(head)) init[i] = { kind: "value" };
    else if (/判定/.test(head) || /^判/.test(head)) init[i] = { kind: "off" };
    // 「尿中馬尿酸分布」のような分布区分の列は 1〜3 を A〜C に読み替える
    else if (/分布/.test(head)) init[i] = { kind: "distribution" };
    else if (key) init[i] = { kind: "legal", itemKey: key };
    else init[i] = { kind: "off" };
  });
  // 尿糖・尿蛋白が「区分番号の列」と「記号(-, +- など)の列(見出しの末尾が『結果』)」の両方で載っているCSVでは、
  // 記号の列で判定する(区分番号 1〜5 は、記号として読めず、強陽性でも異常なしになってしまう)
  const squashHead = (c: string) => c.normalize("NFKC").replace(/\s/g, "");
  h.forEach((c, i) => {
    const m = init[i];
    if (m?.kind !== "legal" || (m.itemKey !== "urine_glucose" && m.itemKey !== "urine_protein")) return;
    const sym = h.findIndex((x, j) => j !== i && squashHead(x) === `${squashHead(c)}結果`);
    const sm = sym >= 0 ? init[sym] : undefined;
    if (sm?.kind === "legal" && sm.itemKey === m.itemKey) init[i] = { kind: "off" };
  });
  return { base: { nameCol, kanaCol, deptCol, empNoCol, sexCol, birthCol, dateCol, judgmentCol }, colModes: init };
}

// 「1回目」「2回目」のように、何回目の測定かが見出しに書かれている血圧の列か
export function isNthReadingHeader(header: string): boolean {
  return /[①②③]/.test(header) || /[1-9一二三]回目/.test(header.normalize("NFKC"));
}

export function readSexCell(v: string): "male" | "female" | null {
  const s = v.trim();
  if (/^(男|男性|M|male|1)$/i.test(s)) return "male";
  if (/^(女|女性|F|female|2)$/i.test(s)) return "female";
  return null;
}

// 列の割り当てに従って、取込用の行を作る(氏名のない行は除く)
export function buildImportRows({
  header,
  dataRows,
  base,
  colModes,
  autoJudge,
  rules,
  checkupType,
  commonDate,
  persons,
}: {
  header: string[];
  dataRows: string[][];
  base: BaseCols;
  colModes: Record<number, ColumnMode>;
  autoJudge: boolean; // 事務所基準で自動判定する
  rules: JudgmentRule[];
  checkupType: string;
  commonDate: string; // 健診日の列が無い・読み取れないときに全員へ使う健診日
  persons: PersonCandidate[];
}): ImportRow[] {
  const { nameCol, kanaCol, deptCol, empNoCol, sexCol, birthCol, dateCol, judgmentCol } = base;
  const baseCols = [nameCol, kanaCol, deptCol, empNoCol, sexCol, birthCol, dateCol, judgmentCol];
  const readSex = (r: string[]) => (sexCol < 0 ? null : readSexCell(r[sexCol] ?? ""));
  const norm = (s: string) => s.replace(/[\s　]/g, "");

  // 血圧を2回測定していて平均の列が無い場合は、平均を求めてそれを判定する。
  // 各回の測定値はそのまま保存するが、判定は付けない(平均で判定する)
  const bpCols = (key: "sbp" | "dbp") =>
    header
      .map((h, i) => ({ h, i }))
      .filter(({ h, i }) => {
        const m = colModes[i];
        return !baseCols.includes(i) && m?.kind === "legal" && m.itemKey === key;
      });
  const sbpCols = bpCols("sbp");
  const dbpCols = bpCols("dbp");
  const hasAvgCol = [...sbpCols, ...dbpCols].some(({ h }) => isAverageHeader(h));
  const needBpAverage = !hasAvgCol && (sbpCols.length >= 2 || dbpCols.length >= 2);
  // 「収縮期血圧」(健診機関が採用した値)と「収縮期血圧(1回目)」「(2回目)」が並ぶCSVでは、
  // 1回目・2回目だけで平均を求める(採用した値は、どちらかの回と同じ値なので、足すと二重に数えてしまう)
  const readingsOf = (cols: { h: string; i: number }[]) => {
    const nth = cols.filter(({ h }) => isNthReadingHeader(h));
    return nth.length >= 2 ? nth : cols;
  };
  // 視力: 同じ側の矯正視力の列に値がある方は、矯正視力で判定する(裸眼の値は残すが、判定は付けない)
  const visionKey = (s: string) => s.normalize("NFKC").replace(/[\s　]/g, "");
  const correctedOf = new Map<number, number>();
  header.forEach((h, i) => {
    const m = colModes[i];
    if (baseCols.includes(i) || m?.kind !== "legal" || m.itemKey !== "vision" || /矯正/.test(h)) return;
    const j = header.findIndex((x, k) => {
      const mk = colModes[k];
      return k !== i && !baseCols.includes(k) && mk?.kind === "legal" && mk.itemKey === "vision" && /矯正/.test(x) && visionKey(x).replace(/[:・,、]?矯正(視力)?/, "") === visionKey(h);
    });
    if (j >= 0) correctedOf.set(i, j);
  });
  const bpReadingCols = new Set<number>(
    needBpAverage ? [...sbpCols, ...dbpCols].map(({ i }) => i) : []
  );

  return dataRows
    .map((r) => {
      const sex = readSex(r);
      const items: { name: string; value?: string; judgment?: string }[] = [];
      const autoGrades: (Grade | null)[] = [];

      header.forEach((h, i) => {
        if (baseCols.includes(i)) return;
        const mode = colModes[i] ?? { kind: "off" as const };
        if (mode.kind === "off") return;
        let cell = (r[i] ?? "").trim();
        // 自覚症状・他覚症状は空欄を「なし」(A)として記録する(実施者数に数えるため)
        if (!cell && mode.kind === "legal" && (mode.itemKey === "symptoms" || mode.itemKey === "signs")) cell = "なし";
        if (!cell) return;

        // 各回の血圧は値だけ保存し、判定は平均で行う
        if (bpReadingCols.has(i)) {
          items.push({ name: h.trim(), value: cell });
          return;
        }

        // 矯正視力のある方の裸眼視力は、値だけ保存する(判定は矯正視力で行う)
        const corrected = correctedOf.get(i);
        if (corrected != null && (r[corrected] ?? "").trim() !== "") {
          items.push({ name: h.trim(), value: cell });
          return;
        }

        if (mode.kind === "legal" && autoJudge) {
          // 「142/90」形式の血圧は収縮期・拡張期に分けて判定
          if (mode.itemKey === "sbp" || mode.itemKey === "dbp") {
            const bp = splitBloodPressure(cell);
            if (bp.sbp != null && bp.dbp != null) {
              const gs = judgeItem("sbp", String(bp.sbp), sex, rules);
              const gd = judgeItem("dbp", String(bp.dbp), sex, rules);
              const g = worstGrade([gs, gd]);
              autoGrades.push(g);
              items.push({ name: h.trim(), value: cell, judgment: g ?? undefined });
              return;
            }
          }
          const g = judgeItem(mode.itemKey, cell, sex, rules);
          // 自覚症状・他覚症状の「あり」(C)は有所見項目として残すが、総合判定(最も重い項目判定)には含めない
          if (mode.itemKey !== "symptoms" && mode.itemKey !== "signs") autoGrades.push(g);
          items.push({ name: h.trim(), value: cell, judgment: g ?? undefined });
          return;
        }
        if (mode.kind === "judgment") {
          // 「17 A」のように数値の右に判定が付いた表記は値と判定に分ける。
          // 「B」「要観察」などの表記は A〜E に読み替えて判定に入れ、元の表記は値として残す
          const vg = splitValueGrade(cell);
          if (vg.grade) {
            items.push({ name: h.trim(), value: vg.value, judgment: vg.grade });
            return;
          }
          items.push({ name: h.trim(), value: cell, judgment: normalizeGradeText(cell) ?? cell.toUpperCase() });
          return;
        }
        if (mode.kind === "distribution") {
          // 生物学的モニタリングの分布区分: 「0.16①」「2」などの 1〜3 を A〜C として判定に入れる
          const d = splitDistribution(cell);
          items.push({
            name: h.trim(),
            value: d.dist ? `${d.value ? d.value + " " : ""}分布${d.dist}` : cell,
            judgment: d.grade ?? undefined,
          });
          return;
        }
        items.push({ name: h.trim(), value: cell });
      });

      // 血圧2回測定の平均(平均の列が無い場合のみ)
      if (needBpAverage) {
        // 「142/90」形式の列は収縮期の列として読み取られるため、拡張期もそこから求める
        const sbpReadings = readingsOf(sbpCols).map(({ i }) => r[i] ?? "");
        const dbpReadings = readingsOf(dbpCols.length > 0 ? dbpCols : sbpCols).map(({ i }) => r[i] ?? "");
        const sbpAvg = averageBloodPressure(sbpReadings, "sbp");
        const dbpAvg = averageBloodPressure(dbpReadings, "dbp");
        if (sbpAvg != null) {
          const g = autoJudge ? judgeItem("sbp", String(sbpAvg), sex, rules) : null;
          autoGrades.push(g);
          items.push({ name: "収縮期血圧(平均)", value: String(sbpAvg), judgment: g ?? undefined });
        }
        if (dbpAvg != null) {
          const g = autoJudge ? judgeItem("dbp", String(dbpAvg), sex, rules) : null;
          autoGrades.push(g);
          items.push({ name: "拡張期血圧(平均)", value: String(dbpAvg), judgment: g ?? undefined });
        }
      }

      // 「〇〇判定」列を同名の測定値項目にマージ
      const merged: typeof items = [];
      for (const it of items) {
        if (it.judgment && !it.value) {
          const base = norm(it.name).replace(/判定$/, "");
          const target = merged.find((m) => norm(m.name) === base);
          if (target && !target.judgment) {
            target.judgment = it.judgment;
            continue;
          }
          merged.push({ ...it, name: base || it.name });
          continue;
        }
        merged.push(it);
      }

      const csvOverallRaw = judgmentCol >= 0 ? (r[judgmentCol] ?? "").trim() : "";
      // 特殊健診の管理区分(A・B1・B2・C・R・T)はそのまま残す(B1 と B2 を区別するため)。それ以外は A〜E に読み替える
      const specialCode = csvOverallRaw.normalize("NFKC").trim().toUpperCase();
      const csvOverall = csvOverallRaw
        ? checkupType === "special" && /^(A|B1|B2|C|R|T)$/.test(specialCode)
          ? specialCode
          : (normalizeGradeText(csvOverallRaw) ?? csvOverallRaw.toUpperCase())
        : "";
      // 自動判定ONのときは、最も重い項目判定を総合判定とする
      // (Rは就業制限の検討を表す印のため、総合判定としてはDに読み替える)
      const autoOverall = autoJudge ? overallGrade(worstGrade(autoGrades)) : null;

      const targetName = (r[nameCol] ?? "").trim();
      const employeeNo = empNoCol >= 0 ? (r[empNoCol] ?? "").trim() : "";
      const birthDate = birthCol >= 0 ? normalizeDate(r[birthCol] ?? "") : null;
      // 社員番号・生年月日・氏名で個人カルテに突合する
      const person = matchPerson(persons, {
        name: targetName,
        employeeNo,
        birthDate,
      });

      return {
        target_name: targetName,
        target_name_kana: kanaCol >= 0 ? (r[kanaCol] ?? "").trim() : "",
        department: deptCol >= 0 ? (r[deptCol] ?? "").trim() : "",
        employee_no: employeeNo,
        sex: sex ?? "",
        birth_date: birthDate ?? "",
        person_id: person?.id ?? "",
        target_user_id: person?.user_id ?? "",
        // 列の値が無い・読み取れないときは「全員共通の健診日」を使う
        checkup_date: (dateCol >= 0 ? normalizeDate(r[dateCol] ?? "") : null) ?? normalizeDate(commonDate),
        // 特殊健診は健診機関の総合判定(A・B1・B2・C・R・T)を優先する(無ければ事務所基準の自動判定)
        overall_judgment: checkupType === "special" ? csvOverall || autoOverall || "" : autoOverall ?? csvOverall,
        items: merged,
        needs_followup: false,
      };
    })
    .filter((r) => r.target_name)
    .map((row) => {
      const sex = row.sex === "male" || row.sex === "female" ? row.sex : null;
      const marked = markReferral(row.items.map((it) => ({ item_name: it.name, judgment: it.judgment ?? null, value: it.value ?? null })), sex, rules);
      return { ...row, needs_followup: needsReferral(row.overall_judgment, marked) };
    });
}
