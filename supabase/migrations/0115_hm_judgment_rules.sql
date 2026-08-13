-- ============================================================
-- 0115_hm_judgment_rules.sql : 事務所独自の自動判定基準(A〜D)
-- ============================================================
-- 労働安全衛生法に基づく定期健康診断の法定検査項目のみを対象に、
-- 検査値から A/B/C/D を自動判定するための基準マスタ。
--   * 判定は A(異常なし) / B(軽度異常) / C(要再検査・生活改善) / D(要精検・治療)
--     の4区分のみ。E(治療中)は判定しない。
--   * 1項目に複数のルールが該当した場合、および複数項目に異常がある場合は
--     最も重い判定を採用する(アプリ側で実装)。
--   * 初期値は日本人間ドック予防医療協会の判定区分に準拠。
--     運用前に画面(判定基準の設定)で必ず内容をご確認ください。
-- 編集はofficeのみ。閲覧は認証ユーザー全員(取込時の判定に使用)。
-- ============================================================

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

create policy hm_judgment_rules_select on public.hm_judgment_rules
  for select using (auth.uid() is not null);

create policy hm_judgment_rules_insert on public.hm_judgment_rules
  for insert with check (public.hm_is_office());

create policy hm_judgment_rules_update on public.hm_judgment_rules
  for update using (public.hm_is_office()) with check (public.hm_is_office());

create policy hm_judgment_rules_delete on public.hm_judgment_rules
  for delete using (public.hm_is_office());

-- ------------------------------------------------------------
-- 初期データ(既にデータがある場合は投入しない)
-- ------------------------------------------------------------
insert into public.hm_judgment_rules
  (item_key, item_label, unit, sex, grade, min_value, max_value, match_text, sort_order)
select * from (values
  -- BMI
  ('bmi', 'BMI', 'kg/m2', 'all', 'C', null, 18.4, null, 1),
  ('bmi', 'BMI', 'kg/m2', 'all', 'C', 25.0, 29.9, null, 2),
  ('bmi', 'BMI', 'kg/m2', 'all', 'D', 30.0, null, null, 3),
  -- 腹囲
  ('waist', '腹囲', 'cm', 'male', 'C', 85.0, null, null, 1),
  ('waist', '腹囲', 'cm', 'female', 'C', 90.0, null, null, 1),
  -- 血圧
  ('sbp', '収縮期血圧', 'mmHg', 'all', 'B', 130, 139, null, 1),
  ('sbp', '収縮期血圧', 'mmHg', 'all', 'C', 140, 159, null, 2),
  ('sbp', '収縮期血圧', 'mmHg', 'all', 'D', 160, null, null, 3),
  ('dbp', '拡張期血圧', 'mmHg', 'all', 'B', 85, 89, null, 1),
  ('dbp', '拡張期血圧', 'mmHg', 'all', 'C', 90, 99, null, 2),
  ('dbp', '拡張期血圧', 'mmHg', 'all', 'D', 100, null, null, 3),
  -- 肝機能
  ('ast', 'AST(GOT)', 'U/L', 'all', 'B', 31, 35, null, 1),
  ('ast', 'AST(GOT)', 'U/L', 'all', 'C', 36, 50, null, 2),
  ('ast', 'AST(GOT)', 'U/L', 'all', 'D', 51, null, null, 3),
  ('alt', 'ALT(GPT)', 'U/L', 'all', 'B', 31, 40, null, 1),
  ('alt', 'ALT(GPT)', 'U/L', 'all', 'C', 41, 50, null, 2),
  ('alt', 'ALT(GPT)', 'U/L', 'all', 'D', 51, null, null, 3),
  ('ggt', 'γ-GT(γ-GTP)', 'U/L', 'all', 'B', 51, 80, null, 1),
  ('ggt', 'γ-GT(γ-GTP)', 'U/L', 'all', 'C', 81, 100, null, 2),
  ('ggt', 'γ-GT(γ-GTP)', 'U/L', 'all', 'D', 101, null, null, 3),
  -- 血中脂質
  ('tg', '中性脂肪(TG)', 'mg/dL', 'all', 'C', null, 29, null, 1),
  ('tg', '中性脂肪(TG)', 'mg/dL', 'all', 'B', 150, 199, null, 2),
  ('tg', '中性脂肪(TG)', 'mg/dL', 'all', 'C', 200, 399, null, 3),
  ('tg', '中性脂肪(TG)', 'mg/dL', 'all', 'D', 400, null, null, 4),
  ('hdl', 'HDLコレステロール', 'mg/dL', 'all', 'B', 35, 39, null, 1),
  ('hdl', 'HDLコレステロール', 'mg/dL', 'all', 'C', 30, 34, null, 2),
  ('hdl', 'HDLコレステロール', 'mg/dL', 'all', 'D', null, 29, null, 3),
  ('ldl', 'LDLコレステロール', 'mg/dL', 'all', 'C', null, 59, null, 1),
  ('ldl', 'LDLコレステロール', 'mg/dL', 'all', 'B', 120, 139, null, 2),
  ('ldl', 'LDLコレステロール', 'mg/dL', 'all', 'C', 140, 179, null, 3),
  ('ldl', 'LDLコレステロール', 'mg/dL', 'all', 'D', 180, null, null, 4),
  -- 血糖
  ('glucose', '空腹時血糖', 'mg/dL', 'all', 'B', 100, 109, null, 1),
  ('glucose', '空腹時血糖', 'mg/dL', 'all', 'C', 110, 125, null, 2),
  ('glucose', '空腹時血糖', 'mg/dL', 'all', 'D', 126, null, null, 3),
  ('hba1c', 'HbA1c(NGSP)', '%', 'all', 'B', 5.6, 5.9, null, 1),
  ('hba1c', 'HbA1c(NGSP)', '%', 'all', 'C', 6.0, 6.4, null, 2),
  ('hba1c', 'HbA1c(NGSP)', '%', 'all', 'D', 6.5, null, null, 3),
  -- 貧血
  ('hb', '血色素量(Hb)', 'g/dL', 'male', 'B', 12.1, 13.0, null, 1),
  ('hb', '血色素量(Hb)', 'g/dL', 'male', 'B', 16.4, 18.0, null, 2),
  ('hb', '血色素量(Hb)', 'g/dL', 'male', 'C', 10.0, 12.0, null, 3),
  ('hb', '血色素量(Hb)', 'g/dL', 'male', 'C', 18.1, null, null, 4),
  ('hb', '血色素量(Hb)', 'g/dL', 'male', 'D', null, 9.9, null, 5),
  ('hb', '血色素量(Hb)', 'g/dL', 'female', 'B', 11.1, 12.0, null, 1),
  ('hb', '血色素量(Hb)', 'g/dL', 'female', 'B', 14.6, 16.0, null, 2),
  ('hb', '血色素量(Hb)', 'g/dL', 'female', 'C', 10.0, 11.0, null, 3),
  ('hb', '血色素量(Hb)', 'g/dL', 'female', 'C', 16.1, null, null, 4),
  ('hb', '血色素量(Hb)', 'g/dL', 'female', 'D', null, 9.9, null, 5),
  ('rbc', '赤血球数', '万/μL', 'male', 'B', 360, 399, null, 1),
  ('rbc', '赤血球数', '万/μL', 'male', 'B', 540, 599, null, 2),
  ('rbc', '赤血球数', '万/μL', 'male', 'C', 320, 359, null, 3),
  ('rbc', '赤血球数', '万/μL', 'male', 'C', 600, null, null, 4),
  ('rbc', '赤血球数', '万/μL', 'male', 'D', null, 319, null, 5),
  ('rbc', '赤血球数', '万/μL', 'female', 'B', 330, 359, null, 1),
  ('rbc', '赤血球数', '万/μL', 'female', 'B', 490, 549, null, 2),
  ('rbc', '赤血球数', '万/μL', 'female', 'C', 300, 329, null, 3),
  ('rbc', '赤血球数', '万/μL', 'female', 'C', 550, null, null, 4),
  ('rbc', '赤血球数', '万/μL', 'female', 'D', null, 299, null, 5),
  -- 尿検査(定性)
  ('urine_glucose', '尿糖', null, 'all', 'C', null, null, '±', 1),
  ('urine_glucose', '尿糖', null, 'all', 'D', null, null, '+', 2),
  ('urine_glucose', '尿糖', null, 'all', 'D', null, null, '2+', 3),
  ('urine_glucose', '尿糖', null, 'all', 'D', null, null, '3+', 4),
  ('urine_protein', '尿蛋白', null, 'all', 'B', null, null, '±', 1),
  ('urine_protein', '尿蛋白', null, 'all', 'C', null, null, '+', 2),
  ('urine_protein', '尿蛋白', null, 'all', 'D', null, null, '2+', 3),
  ('urine_protein', '尿蛋白', null, 'all', 'D', null, null, '3+', 4)
) as seed(item_key, item_label, unit, sex, grade, min_value, max_value, match_text, sort_order)
where not exists (select 1 from public.hm_judgment_rules);

-- 健診対象者の性別(自動判定で性差のある項目に使用)
alter table public.hm_checkups add column if not exists sex text
  check (sex in ('male', 'female'));

-- 取込RPCを性別対応に更新(シグネチャは従来どおり)
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
