-- ============================================================
-- 0126_hm_restriction_rule.sql : 就業制限の検討水準(R)とクレアチニン
-- ============================================================
-- (1) 判定に R(就業制限の検討)を追加する
--     厚生労働科学研究費補助金(労働安全衛生総合研究事業)分担研究報告書
--     「健康診断の有所見者に対して、健康管理を行う事を目的とした、
--       産業医による就業上の意見に関する実態調査、およびコンセンサス調査」
--     でコンセンサスが得られた値を既定として登録する。
--
--       収縮期血圧   180 mmHg 以上
--       拡張期血圧   110 mmHg 以上
--       空腹時血糖   200 mg/dL 以上
--       随時血糖     300 mg/dL 以上
--       HbA1c        10 % 以上
--       血色素量(Hb) 8 g/dL 以下
--       ALT          200 U/L 以上
--       クレアチニン 2.0 mg/dL 以上
--
--     Rは「就業上の措置を検討する段階」を表す印で、総合判定(A〜D)とは別に扱う。
--     一覧では「就業制限項目（R）」の欄に該当項目が表示され、一括判定では
--     「通常勤務可」の対象から外れる。
--
-- (2) クレアチニンを法定項目として追加する(来年度からの法定項目化に先行して対応)
--     A〜Dの区分は事務所の既定値。判定基準の設定画面から変更できる。
--
-- ※ 0117 を再実行すると判定基準がすべて入れ直されるため、
--    0117 のあとに本ファイルを実行すること。
-- ============================================================


-- ------------------------------------------------------------
-- (1) grade に R を許可する
-- ------------------------------------------------------------
alter table public.hm_judgment_rules
  drop constraint if exists hm_judgment_rules_grade_check;

alter table public.hm_judgment_rules
  add constraint hm_judgment_rules_grade_check
  check (grade in ('B', 'C', 'D', 'R'));


-- ------------------------------------------------------------
-- (2) 就業制限の検討水準(R)
--     同じ項目のD規則と重なるが、Rのほうを重く扱うため上書きされない
-- ------------------------------------------------------------
delete from public.hm_judgment_rules where grade = 'R';

insert into public.hm_judgment_rules
  (item_key, item_label, unit, sex, grade, min_value, max_value, match_text, sort_order)
values
  ('sbp', '収縮期血圧', 'mmHg', 'all', 'R', 180, null, null, 90),
  ('dbp', '拡張期血圧', 'mmHg', 'all', 'R', 110, null, null, 90),
  ('glucose', '空腹時血糖(FPG)', 'mg/dL', 'all', 'R', 200, null, null, 90),
  ('casual_glucose', '随時血糖', 'mg/dL', 'all', 'R', 300, null, null, 90),
  ('hba1c', 'HbA1c(NGSP)', '%', 'all', 'R', 10, null, null, 90),
  ('hb', '血色素量(Hb)', 'g/dL', 'all', 'R', null, 8, null, 90),
  ('alt', 'ALT(GPT)', 'U/L', 'all', 'R', 200, null, null, 90),
  ('cre', 'クレアチニン', 'mg/dL', 'all', 'R', 2.0, null, null, 90);


-- ------------------------------------------------------------
-- (3) クレアチニンのA〜D(事務所の既定値)
-- ------------------------------------------------------------
delete from public.hm_judgment_rules where item_key = 'cre' and grade <> 'R';

insert into public.hm_judgment_rules
  (item_key, item_label, unit, sex, grade, min_value, max_value, match_text, sort_order)
values
  -- 男性: A 1.00以下 / B 1.01-1.09 / C 1.10-1.29 / D 1.30以上
  ('cre', 'クレアチニン', 'mg/dL', 'male', 'B', 1.01, 1.09, null, 1),
  ('cre', 'クレアチニン', 'mg/dL', 'male', 'C', 1.10, 1.29, null, 2),
  ('cre', 'クレアチニン', 'mg/dL', 'male', 'D', 1.30, null, null, 3),
  -- 女性: A 0.70以下 / B 0.71-0.79 / C 0.80-0.99 / D 1.00以上
  ('cre', 'クレアチニン', 'mg/dL', 'female', 'B', 0.71, 0.79, null, 1),
  ('cre', 'クレアチニン', 'mg/dL', 'female', 'C', 0.80, 0.99, null, 2),
  ('cre', 'クレアチニン', 'mg/dL', 'female', 'D', 1.00, null, null, 3);


-- ------------------------------------------------------------
-- 適用状況の確認
-- ------------------------------------------------------------
select item_label as 項目,
       sex as 性別,
       grade as 判定,
       coalesce(min_value::text, '(下限なし)') as 下限,
       coalesce(max_value::text, '(上限なし)') as 上限
  from public.hm_judgment_rules
 where grade = 'R' or item_key = 'cre'
 order by item_key, grade, sex, sort_order;
