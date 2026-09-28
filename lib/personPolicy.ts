// 従業員カルテ・面談登録での入力ルール。
// 生年月日は同姓同名の区別に使うが、企業から情報が得られない場合もあるため任意にしている。
// 必須に戻す場合は BIRTH_DATE_REQUIRED を true にするだけでよい
// (画面の「*」表示・入力チェック・マニュアルの文言が連動する)。
export const BIRTH_DATE_REQUIRED = false;

export const BIRTH_DATE_LABEL = BIRTH_DATE_REQUIRED ? "生年月日 *" : "生年月日（任意）";
export const BIRTH_DATE_MANUAL = BIRTH_DATE_REQUIRED ? "生年月日（必須）" : "生年月日（任意。同姓同名の区別に使用）";
