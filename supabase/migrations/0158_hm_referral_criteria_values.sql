-- ============================================================
-- 0158_hm_referral_criteria_values.sql : 受診勧奨の基準(事務所基準)の値を登録する
-- ============================================================
-- 受診勧奨をするかどうか・就業判定の「受診が条件」を決める、事務所の基準(判定基準の区分 S)。
-- 要医療(D)の判定(学会の判定区分)は変えない。
--
--   AST(GOT)            101 以上
--   ALT(GPT)            101 以上
--   γ-GTP               201 以上
--   中性脂肪            500 以上、または 19 以下
--   HDLコレステロール   19 以下
--   LDLコレステロール   180 以上(低い側の基準は設けない)
--   空腹時血糖          150 以上、または 49 以下
--   血色素量(Hb) 男性   10 以下、または 19.1 以上
--   血色素量(Hb) 女性   9 以下、または 17.1 以上
--   赤血球数 男性       300 以下、または 700 以上(×10^4/μL)
--   赤血球数 女性       269 以下、または 600 以上(×10^4/μL)
--
-- 上にない項目(血圧・随時血糖・HbA1c・クレアチニン・尿蛋白 など)は、要医療(D)と同じ値を受診勧奨の基準にする
-- (すでに受診勧奨の基準がある項目は変えない)。
-- 上の11項目は、このSQLの値で入れ直す(画面で変えていても上書きする)。
--
-- 【前提】0156 を先に実行しておく。0157 は実行していなくてもよい(このSQLに同じ内容を含む)
-- 取り込み済みの結果に反映するには、このあと健康診断管理の「判定を再計算（事務所基準）」を押す。
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

alter table public.hm_judgment_rules drop constraint if exists hm_judgment_rules_grade_check;
alter table public.hm_judgment_rules add constraint hm_judgment_rules_grade_check
  check (grade in ('B', 'C', 'D', 'R', 'S'));

-- 1. 指定のあった項目の受診勧奨の基準を入れ直す
delete from public.hm_judgment_rules
 where grade = 'S'
   and item_key in ('ast', 'alt', 'ggt', 'tg', 'hdl', 'ldl', 'glucose', 'hb', 'rbc');

insert into public.hm_judgment_rules
  (item_key, item_label, unit, sex, grade, min_value, max_value, match_text, sort_order)
values
  ('ast',     'AST(GOT)',           'U/L',      'all',    'S', 101,  null, null, 1),
  ('alt',     'ALT(GPT)',           'U/L',      'all',    'S', 101,  null, null, 1),
  ('ggt',     'γ-GT(γ-GTP)',        'U/L',      'all',    'S', 201,  null, null, 1),
  ('tg',      '中性脂肪(TG)',       'mg/dL',    'all',    'S', 500,  null, null, 1),
  ('tg',      '中性脂肪(TG)',       'mg/dL',    'all',    'S', null, 19,   null, 2),
  ('hdl',     'HDLコレステロール',  'mg/dL',    'all',    'S', null, 19,   null, 1),
  ('ldl',     'LDLコレステロール',  'mg/dL',    'all',    'S', 180,  null, null, 1),
  ('glucose', '空腹時血糖(FPG)',    'mg/dL',    'all',    'S', 150,  null, null, 1),
  ('glucose', '空腹時血糖(FPG)',    'mg/dL',    'all',    'S', null, 49,   null, 2),
  ('hb',      '血色素量(Hb)',       'g/dL',     'male',   'S', null, 10,   null, 1),
  ('hb',      '血色素量(Hb)',       'g/dL',     'male',   'S', 19.1, null, null, 2),
  ('hb',      '血色素量(Hb)',       'g/dL',     'female', 'S', null, 9,    null, 1),
  ('hb',      '血色素量(Hb)',       'g/dL',     'female', 'S', 17.1, null, null, 2),
  ('rbc',     '赤血球数',           '×10^4/μL', 'male',   'S', null, 300,  null, 1),
  ('rbc',     '赤血球数',           '×10^4/μL', 'male',   'S', 700,  null, null, 2),
  ('rbc',     '赤血球数',           '×10^4/μL', 'female', 'S', null, 269,  null, 1),
  ('rbc',     '赤血球数',           '×10^4/μL', 'female', 'S', 600,  null, null, 2);

-- 2. そのほかの項目: 受診勧奨の基準がまだなければ、要医療(D)と同じ値で登録する(0157 と同じ)
insert into public.hm_judgment_rules (item_key, item_label, unit, sex, grade, min_value, max_value, match_text, sort_order)
select d.item_key, d.item_label, d.unit, d.sex, 'S', d.min_value, d.max_value, d.match_text, d.sort_order
  from public.hm_judgment_rules d
 where d.grade = 'D'
   and not exists (select 1 from public.hm_judgment_rules s where s.item_key = d.item_key and s.grade = 'S');

-- 登録された値の一覧(要医療(D)と、受診勧奨(事務所基準)を並べて確かめる)
select d.item_label as 項目,
       case d.sex when 'male' then '男性' when 'female' then '女性' else '共通' end as 対象,
       string_agg(distinct coalesce(d.match_text, concat_ws('', d.min_value::text || ' 以上', d.max_value::text || ' 以下')), ' / ') as "要医療(D)",
       (select string_agg(coalesce(s.match_text, concat_ws('', s.min_value::text || ' 以上', s.max_value::text || ' 以下')), ' / ' order by s.sort_order)
          from public.hm_judgment_rules s where s.item_key = d.item_key and s.grade = 'S' and s.sex in (d.sex, 'all')) as "受診勧奨(事務所基準)"
  from public.hm_judgment_rules d
 where d.grade = 'D'
 group by d.item_key, d.item_label, d.sex
 order by d.item_key, d.sex;
