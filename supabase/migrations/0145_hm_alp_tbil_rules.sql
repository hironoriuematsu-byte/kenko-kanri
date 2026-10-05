-- ============================================================
-- 0145_hm_alp_tbil_rules.sql : ALP・総ビリルビンの判定基準を追加(特殊健診の肝機能項目)
-- ============================================================
-- 特定化学物質健診の結果票にある ALP と総ビリルビンを、取込時に法定項目として自動判定する。
--   ALP:       113以下 A / 114以上 C
--   総ビリルビン: 1.5以下 A / 1.6以上 C
-- 事務所の方針に合わせて「判定基準の設定(A〜D)」の画面から変更できる。
-- ※ 0117 を再実行すると判定基準がすべて入れ直されるため、0117 のあとに本ファイルを実行すること。
--
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

delete from public.hm_judgment_rules where item_key in ('alp', 'tbil');

insert into public.hm_judgment_rules
  (item_key, item_label, unit, sex, grade, min_value, max_value, match_text, sort_order)
values
  ('alp',  'ALP',        'U/L',   'all', 'C', 114, null, null, 1),
  ('tbil', '総ビリルビン', 'mg/dL', 'all', 'C', 1.6, null, null, 1);

-- 確認
select item_label as 項目, grade as 判定,
       coalesce(min_value::text, '(下限なし)') as 下限,
       coalesce(max_value::text, '(上限なし)') as 上限
  from public.hm_judgment_rules
 where item_key in ('alp', 'tbil')
 order by item_key;
