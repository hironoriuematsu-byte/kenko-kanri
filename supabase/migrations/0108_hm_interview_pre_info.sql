-- ============================================================
-- 0108_hm_interview_pre_info.sql : 面談の事前情報欄
-- ============================================================
-- 企業担当者・産業医事務所が面談前に共有するメモ(残業時間・勤怠状況・経緯等)。
-- 対象の従業員本人には表示しないため、列GRANTを与えず(0102でgrantは列指定済み)、
-- 読み書きは office / company(自社) 限定のRPC経由とする。
-- ============================================================

alter table public.hm_interviews add column if not exists pre_info text;

create or replace function public.hm_get_interview_pre_info(p_id uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_text text;
begin
  select company_id, pre_info into v_company, v_text
    from public.hm_interviews where id = p_id;
  if v_company is null then
    raise exception 'interview not found';
  end if;
  if not (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and v_company = public.hm_my_company())
  ) then
    raise exception 'permission denied';
  end if;
  return v_text;
end;
$$;

create or replace function public.hm_save_interview_pre_info(p_id uuid, p_text text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.hm_interviews where id = p_id;
  if v_company is null then
    raise exception 'interview not found';
  end if;
  if not (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and v_company = public.hm_my_company())
  ) then
    raise exception 'permission denied';
  end if;
  update public.hm_interviews
     set pre_info = nullif(p_text, ''), updated_at = now()
   where id = p_id;
  perform public.hm_log_access('save_pre_info', 'hm_interviews', p_id, null);
end;
$$;
