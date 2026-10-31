-- 现有共同计划保存在 together_items；统一心愿的读取字段，沿用原数据及其 RLS。
-- security_invoker 让视图以调用者权限访问底表，避免视图所有者绕过情侣隔离。
create view public.wishes with (security_invoker = true) as
select id, couple_id, created_by, title, note as description,
       completed as is_completed, created_at
from public.together_items;

comment on view public.wishes is '共同心愿读取接口，映射 together_items 并遵循调用者的 RLS';
revoke all on public.wishes from public, anon, authenticated;
grant select on public.wishes to authenticated, service_role;
