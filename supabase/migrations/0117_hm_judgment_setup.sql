-- ============================================================
-- 0117_hm_judgment_setup.sql :
--   健診結果の自動判定の一式(テーブル作成 + 判定区分2026年4月1日改定の数値)
-- ============================================================
-- 日本人間ドック・予防医療学会の判定区分表(2026年4月1日改定)のうち、
-- 労働安全衛生規則第44条の定期健康診断の法定検査項目のみを登録する。
--   * A(異常なし) / B(軽度異常) / C(要再検査・生活改善) / D(要精密検査・治療)
--     の4区分のみ。E(治療中)は自動判定しない。
--   * 判定区分表に区分の記載がない項目(赤血球数など)は自動判定の対象外。
-- ※ このファイルは単独で完結します。他の判定関連SQLは実行不要です。
-- ※ 既存のルールはすべて削除して入れ直します。画面で独自に調整済みの場合は
--    実行前に内容を控えてください。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 判定基準マスタ(未作成の場合は作成)
-- ------------------------------------------------------------

create table if not exists public.hm_judgment_rules (
  id uuid primary key default gen_random_uuid(),
  item_key text not null,          -- bmi, sbp, ldl 等
  item_label text not null,        -- 画面表示名
  unit text,
  sex text not null default 'all' check (sex in ('all', 'male', 'female')),
  grade text not null check (grade in ('B', 'C', 'D')),
  min_value numeric,               -- null = 下限なし
  max_value numeric,               -- null = 上限なし
  match_text text,                 -- 定性検査(尿糖・尿蛋白)の一致文字列
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists hm_judgment_rules_item_idx
  on public.hm_judgment_rules (item_key, sort_order);

alter table public.hm_judgment_rules enable row level security;

drop policy if exists hm_judgment_rules_select on public.hm_judgment_rules;
drop policy if exists hm_judgment_rules_insert on public.hm_judgment_rules;
drop policy if exists hm_judgment_rules_update on public.hm_judgment_rules;
drop policy if exists hm_judgment_rules_delete on public.hm_judgment_rules;

create policy hm_judgment_rules_select on public.hm_judgment_rules
  for select using (auth.uid() is not null);
create policy hm_judgment_rules_insert on public.hm_judgment_rules
  for insert with check (public.hm_is_office());
create policy hm_judgment_rules_update on public.hm_judgment_rules
  for update using (public.hm_is_office()) with check (public.hm_is_office());
create policy hm_judgment_rules_delete on public.hm_judgment_rules
  for delete using (public.hm_is_office());

-- ------------------------------------------------------------
-- 2. 健診対象者の性別(自動判定で性差のある項目に使用)と取込RPCの更新
-- ------------------------------------------------------------

alter table public.hm_checkups add column if not exists sex text
  check (sex in ('male', 'female'));

create or replace function public.hm_import_checkups(
  p_company_id uuid,
  p_fiscal_year int,
  p_checkup_type text,
  p_findings_judgments text[],
  p_rows jsonb
)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_item jsonb;
  v_checkup_id uuid;
  v_count int := 0;
  v_has_findings boolean;
  v_order int;
begin
  if not (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and p_company_id = public.hm_my_company())
  ) then
    raise exception 'permission denied';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid rows';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    if coalesce(trim(v_row ->> 'target_name'), '') = '' then
      continue;
    end if;

    v_has_findings :=
      (v_row ->> 'overall_judgment') = any (coalesce(p_findings_judgments, '{}'));
    if not v_has_findings and v_row ? 'items' then
      select exists (
        select 1 from jsonb_array_elements(v_row -> 'items') it
        where (it ->> 'judgment') = any (coalesce(p_findings_judgments, '{}'))
      ) into v_has_findings;
    end if;

    insert into public.hm_checkups (
      company_id, target_user_id, target_name, employee_no, sex,
      fiscal_year, checkup_type, checkup_date, overall_judgment,
      has_findings, followup_status, created_by
    ) values (
      p_company_id,
      nullif(v_row ->> 'target_user_id', '')::uuid,
      trim(v_row ->> 'target_name'),
      nullif(trim(coalesce(v_row ->> 'employee_no', '')), ''),
      nullif(v_row ->> 'sex', ''),
      p_fiscal_year,
      p_checkup_type,
      nullif(v_row ->> 'checkup_date', '')::date,
      nullif(trim(coalesce(v_row ->> 'overall_judgment', '')), ''),
      v_has_findings,
      case when v_has_findings then 'pending' else 'none' end,
      auth.uid()
    ) returning id into v_checkup_id;

    v_order := 0;
    if v_row ? 'items' then
      for v_item in select * from jsonb_array_elements(v_row -> 'items') loop
        if coalesce(trim(v_item ->> 'name'), '') = '' then
          continue;
        end if;
        insert into public.hm_checkup_items (checkup_id, item_name, value, judgment, sort_order)
        values (
          v_checkup_id,
          trim(v_item ->> 'name'),
          nullif(trim(coalesce(v_item ->> 'value', '')), ''),
          nullif(trim(coalesce(v_item ->> 'judgment', '')), ''),
          v_order
        );
        v_order := v_order + 1;
      end loop;
    end if;

    v_count := v_count + 1;
  end loop;

  perform public.hm_log_access(
    'import', 'hm_checkups', null,
    jsonb_build_object(
      'company_id', p_company_id,
      'fiscal_year', p_fiscal_year,
      'checkup_type', p_checkup_type,
      'count', v_count
    )
  );
  return v_count;
end;
$$;

-- ------------------------------------------------------------
-- 3. 判定基準の登録(既存はすべて削除して入れ直す)
-- ------------------------------------------------------------

delete from public.hm_judgment_rules;

insert into public.hm_judgment_rules
  (item_key, item_label, unit, sex, grade, min_value, max_value, match_text, sort_order)
values
  -- 体格指数(BMI): A 18.5-24.9 / C 18.4以下, 25.0以上
  ('bmi', 'BMI', 'kg/m2', 'all', 'C', null, 18.4, null, 1),
  ('bmi', 'BMI', 'kg/m2', 'all', 'C', 25.0, null, null, 2),
  -- 腹囲: 男 A 84.9以下 / C 85.0以上、女 A 89.9以下 / C 90.0以上
  ('waist', '腹囲', 'cm', 'male', 'C', 85.0, null, null, 1),
  ('waist', '腹囲', 'cm', 'female', 'C', 90.0, null, null, 1),
  -- 視力(悪い側で判定): A 1.0以上 / B 0.7-0.9 / C 0.6以下
  ('vision', '視力', null, 'all', 'B', 0.7, 0.9, null, 1),
  ('vision', '視力', null, 'all', 'C', null, 0.6, null, 2),
  -- 聴力: A 30以下 / B 35 / C 40以上 (35〜39dBはB扱い)
  ('hearing1000', '聴力 1000Hz', 'dB', 'all', 'B', 31, 39, null, 1),
  ('hearing1000', '聴力 1000Hz', 'dB', 'all', 'C', 40, null, null, 2),
  ('hearing4000', '聴力 4000Hz', 'dB', 'all', 'B', 31, 39, null, 1),
  ('hearing4000', '聴力 4000Hz', 'dB', 'all', 'C', 40, null, null, 2),
  -- 血圧: 収縮期 A 129以下 / B 130-139 / C 140-159 / D 160以上
  ('sbp', '収縮期血圧', 'mmHg', 'all', 'B', 130, 139, null, 1),
  ('sbp', '収縮期血圧', 'mmHg', 'all', 'C', 140, 159, null, 2),
  ('sbp', '収縮期血圧', 'mmHg', 'all', 'D', 160, null, null, 3),
  -- 拡張期 A 84以下 / B 85-89 / C 90-99 / D 100以上
  ('dbp', '拡張期血圧', 'mmHg', 'all', 'B', 85, 89, null, 1),
  ('dbp', '拡張期血圧', 'mmHg', 'all', 'C', 90, 99, null, 2),
  ('dbp', '拡張期血圧', 'mmHg', 'all', 'D', 100, null, null, 3),
  -- 血色素量: 男 A 13.1-16.3 / B 16.4-18.0 / C 12.1-13.0 / D 12.0以下, 18.1以上
  ('hb', '血色素量(Hb)', 'g/dL', 'male', 'B', 16.4, 18.0, null, 1),
  ('hb', '血色素量(Hb)', 'g/dL', 'male', 'C', 12.1, 13.0, null, 2),
  ('hb', '血色素量(Hb)', 'g/dL', 'male', 'D', null, 12.0, null, 3),
  ('hb', '血色素量(Hb)', 'g/dL', 'male', 'D', 18.1, null, null, 4),
  -- 女 A 12.1-14.5 / B 14.6-16.0 / C 11.1-12.0 / D 11.0以下, 16.1以上
  ('hb', '血色素量(Hb)', 'g/dL', 'female', 'B', 14.6, 16.0, null, 1),
  ('hb', '血色素量(Hb)', 'g/dL', 'female', 'C', 11.1, 12.0, null, 2),
  ('hb', '血色素量(Hb)', 'g/dL', 'female', 'D', null, 11.0, null, 3),
  ('hb', '血色素量(Hb)', 'g/dL', 'female', 'D', 16.1, null, null, 4),
  -- AST(GOT): A 30以下 / B 31-35 / C 36-50 / D 51以上
  ('ast', 'AST(GOT)', 'U/L', 'all', 'B', 31, 35, null, 1),
  ('ast', 'AST(GOT)', 'U/L', 'all', 'C', 36, 50, null, 2),
  ('ast', 'AST(GOT)', 'U/L', 'all', 'D', 51, null, null, 3),
  -- ALT(GPT): A 30以下 / B 31-40 / C 41-50 / D 51以上
  ('alt', 'ALT(GPT)', 'U/L', 'all', 'B', 31, 40, null, 1),
  ('alt', 'ALT(GPT)', 'U/L', 'all', 'C', 41, 50, null, 2),
  ('alt', 'ALT(GPT)', 'U/L', 'all', 'D', 51, null, null, 3),
  -- γ-GT(γ-GTP): A 50以下 / B 51-80 / C 81-100 / D 101以上
  ('ggt', 'γ-GT(γ-GTP)', 'U/L', 'all', 'B', 51, 80, null, 1),
  ('ggt', 'γ-GT(γ-GTP)', 'U/L', 'all', 'C', 81, 100, null, 2),
  ('ggt', 'γ-GT(γ-GTP)', 'U/L', 'all', 'D', 101, null, null, 3),
  -- HDLコレステロール: A 40以上 / C 30-39 / D 29以下
  ('hdl', 'HDLコレステロール', 'mg/dL', 'all', 'C', 30, 39, null, 1),
  ('hdl', 'HDLコレステロール', 'mg/dL', 'all', 'D', null, 29, null, 2),
  -- LDLコレステロール: A 60-119 / B 120-139 / C 140-179 / D 59以下, 180以上
  ('ldl', 'LDLコレステロール', 'mg/dL', 'all', 'B', 120, 139, null, 1),
  ('ldl', 'LDLコレステロール', 'mg/dL', 'all', 'C', 140, 179, null, 2),
  ('ldl', 'LDLコレステロール', 'mg/dL', 'all', 'D', null, 59, null, 3),
  ('ldl', 'LDLコレステロール', 'mg/dL', 'all', 'D', 180, null, null, 4),
  -- 中性脂肪: A 30-149 / B 150-299 / C 300-499 / D 29以下, 500以上
  ('tg', '中性脂肪(TG)', 'mg/dL', 'all', 'B', 150, 299, null, 1),
  ('tg', '中性脂肪(TG)', 'mg/dL', 'all', 'C', 300, 499, null, 2),
  ('tg', '中性脂肪(TG)', 'mg/dL', 'all', 'D', null, 29, null, 3),
  ('tg', '中性脂肪(TG)', 'mg/dL', 'all', 'D', 500, null, null, 4),
  -- 空腹時血糖: A 70-99 / B 100-109 / C 110-125, 54-69 / D 126以上, 53以下
  ('glucose', '空腹時血糖(FPG)', 'mg/dL', 'all', 'B', 100, 109, null, 1),
  ('glucose', '空腹時血糖(FPG)', 'mg/dL', 'all', 'C', 110, 125, null, 2),
  ('glucose', '空腹時血糖(FPG)', 'mg/dL', 'all', 'C', 54, 69, null, 3),
  ('glucose', '空腹時血糖(FPG)', 'mg/dL', 'all', 'D', 126, null, null, 4),
  ('glucose', '空腹時血糖(FPG)', 'mg/dL', 'all', 'D', null, 53, null, 5),
  -- HbA1c: A 5.5以下 / B 5.6-5.9 / C 6.0-6.4 / D 6.5以上
  ('hba1c', 'HbA1c(NGSP)', '%', 'all', 'B', 5.6, 5.9, null, 1),
  ('hba1c', 'HbA1c(NGSP)', '%', 'all', 'C', 6.0, 6.4, null, 2),
  ('hba1c', 'HbA1c(NGSP)', '%', 'all', 'D', 6.5, null, null, 3),
  -- 尿蛋白: A (-) / B (±) / C (+) / D (2+)以上
  ('urine_protein', '尿蛋白', null, 'all', 'B', null, null, '±', 1),
  ('urine_protein', '尿蛋白', null, 'all', 'C', null, null, '+', 2),
  ('urine_protein', '尿蛋白', null, 'all', 'D', null, null, '2+', 3),
  ('urine_protein', '尿蛋白', null, 'all', 'D', null, null, '3+', 4),
  ('urine_protein', '尿蛋白', null, 'all', 'D', null, null, '4+', 5),
  -- 尿糖: A (-) / C (±)以上
  ('urine_glucose', '尿糖', null, 'all', 'C', null, null, '±', 1),
  ('urine_glucose', '尿糖', null, 'all', 'C', null, null, '+', 2),
  ('urine_glucose', '尿糖', null, 'all', 'C', null, null, '2+', 3),
  ('urine_glucose', '尿糖', null, 'all', 'C', null, null, '3+', 4),
  ('urine_glucose', '尿糖', null, 'all', 'C', null, null, '4+', 5);
