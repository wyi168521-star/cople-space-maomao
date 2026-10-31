-- 启用 whispers 的 INSERT / UPDATE 实时通知，保留现有 RLS 和列权限。
begin;
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whispers'
  ) then
    alter publication supabase_realtime add table public.whispers;
  end if;
end $$;
commit;
