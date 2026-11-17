-- ============================================================
-- 0157_hm_referral_criteria_all.sql : 受診勧奨の基準(事務所基準)を、すべての項目に登録する
-- ============================================================
-- 受診勧奨をするかどうかは、事務所の「受診勧奨の基準」で決める(0156)。
-- 0156 では γ-GTP だけに基準を登録し、ほかの項目は「要医療(D)ならそのまま受診勧奨」としていた。
-- このSQLでは、要医療(D)の基準を持つすべての項目に、受診勧奨の基準の行を登録する。
--   ・はじめの値は、いまの要医療(D)の基準と同じ(このSQLだけでは、受診勧奨の対象は変わらない)
--   ・γ-GTP は 201 以上(0156 で登録済みならそのまま)
--   ・値は「判定基準」の画面の「受診勧奨の基準（事務所基準）」で、項目ごとに変えられる
--   ・すでに受診勧奨の基準がある項目は、何もしない(画面で変えた値を上書きしない)
--   ・心電図・胸部エックス線は、所見の文言で要医療(D)と判定されたら受診勧奨の対象(数値の基準はない)
--
-- 【前提】0156 を先に実行しておく(未実行でも、このSQLの中で同じ準備をする)
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

-- 0156 と同じ準備(区分 S を登録できるようにする。γ-GTP は 201 以上)
alter table public.hm_judgment_rules drop constraint if exists hm_judgment_rules_grade_check;
alter table public.hm_judgment_rules add constraint hm_judgment_rules_grade_check
  check (grade in ('B', 'C', 'D', 'R', 'S'));

insert into public.hm_judgment_rules (item_key, item_label, unit, sex, grade, min_value, max_value, match_text, sort_order)
select 'ggt', 'γ-GT(γ-GTP)', 'U/L', 'all', 'S', 201, null, null, 9
 where not exists (select 1 from public.hm_judgment_rules where item_key = 'ggt' and grade = 'S');

-- 受診勧奨の基準がまだない項目に、要医療(D)の基準と同じ値で登録する
insert into public.hm_judgment_rules (item_key, item_label, unit, sex, grade, min_value, max_value, match_text, sort_order)
select d.item_key, d.item_label, d.unit, d.sex, 'S', d.min_value, d.max_value, d.match_text, d.sort_order
  from public.hm_judgment_rules d
 where d.grade = 'D'
   and not exists (select 1 from public.hm_judgment_rules s where s.item_key = d.item_key and s.grade = 'S');

-- 登録された受診勧奨の基準の一覧(要医療(D)の基準と並べて確かめる)
select d.item_label as 項目,
       case d.sex when 'male' then '男性' when 'female' then '女性' else '共通' end as 対象,
       string_agg(distinct coalesce(d.match_text, concat_ws('', d.min_value::text || ' 以上', d.max_value::text || ' 以下')), ' / ') as "要医療(D)",
       (select string_agg(coalesce(s.match_text, concat_ws('', s.min_value::text || ' 以上', s.max_value::text || ' 以下')), ' / ' order by s.sort_order)
          from public.hm_judgment_rules s where s.item_key = d.item_key and s.grade = 'S' and s.sex = d.sex) as "受診勧奨(事務所基準)"
  from public.hm_judgment_rules d
 where d.grade = 'D'
 group by d.item_key, d.item_label, d.sex
 order by d.item_key, d.sex;
