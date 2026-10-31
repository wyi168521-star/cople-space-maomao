-- 配对只通过登录用户调用的 RPC 写入；不开放 couple_members 的直接写入权限。
begin;

create function public.create_couple(
  p_name_a text,
  p_name_b text,
  p_start_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  new_couple_id uuid;
  name_a_value text := pg_catalog.btrim(p_name_a);
  name_b_value text := pg_catalog.btrim(p_name_b);
begin
  if current_user_id is null then
    raise exception '请先登录' using errcode = '42501';
  end if;

  -- 同一用户的创建和加入请求串行执行；同时确认自动创建的资料已经就绪。
  perform 1 from public.profiles where id = current_user_id for no key update;
  if not found then
    raise exception '用户资料尚未就绪，请重新登录' using errcode = '42501';
  end if;
  if exists (select 1 from public.couple_members where user_id = current_user_id) then
    raise exception '你已经加入了一个情侣空间';
  end if;
  if name_a_value is null or name_b_value is null
    or pg_catalog.char_length(name_a_value) not between 1 and 40
    or pg_catalog.char_length(name_b_value) not between 1 and 40 then
    raise exception '双方昵称需要 1-40 个字符' using errcode = '22023';
  end if;
  if p_start_date is null then
    raise exception '请选择在一起的日期' using errcode = '22023';
  end if;

  -- 同时填写新旧字段，兼容现有组件和同步触发器；旧空间名最多 40 个字符。
  insert into public.couples (
    name, name_a, name_b, relationship_start, start_date, created_by
  ) values (
    pg_catalog.left(name_a_value || ' & ' || name_b_value, 40),
    name_a_value, name_b_value, p_start_date, p_start_date, current_user_id
  ) returning id into new_couple_id;

  begin
    insert into public.couple_members (couple_id, user_id, role)
    values (new_couple_id, current_user_id, 'a');
  exception when unique_violation then
    -- 兼容仍由唯一约束保护的旧配对 RPC；失败时本次新空间一并回滚。
    if exists (select 1 from public.couple_members where user_id = current_user_id) then
      raise exception '你已经加入了一个情侣空间';
    end if;
    raise;
  end;

  return new_couple_id;
end;
$$;

create function public.join_couple(p_couple_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception '请先登录' using errcode = '42501';
  end if;
  if p_couple_id is null then
    raise exception '请输入空间 ID' using errcode = '22023';
  end if;

  perform 1 from public.profiles where id = current_user_id for no key update;
  if not found then
    raise exception '用户资料尚未就绪，请重新登录' using errcode = '42501';
  end if;
  if exists (select 1 from public.couple_members where user_id = current_user_id) then
    raise exception '你已经加入了一个情侣空间';
  end if;

  -- 与原成员触发器使用同一父行锁，防止两人同时抢占最后一个名额。
  perform 1 from public.couples where id = p_couple_id for update;
  if not found then
    raise exception '空间不存在，请核对 ID' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.couple_members where couple_id = p_couple_id and role = 'b'
  ) then
    raise exception '这个空间已满';
  end if;

  begin
    insert into public.couple_members (couple_id, user_id, role)
    values (p_couple_id, current_user_id, 'b');
  exception when unique_violation then
    if exists (select 1 from public.couple_members where user_id = current_user_id) then
      raise exception '你已经加入了一个情侣空间';
    end if;
    raise;
  end;

  return p_couple_id;
end;
$$;

revoke all on function public.create_couple(text, text, date) from public, anon, authenticated, service_role;
revoke all on function public.join_couple(uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_couple(text, text, date) to authenticated;
grant execute on function public.join_couple(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
