-- Saldo — licencia de por vida con código de activación
-- - saldo_codigos: códigos que genera el administrador y se entregan al comprador
-- - saldo_licencias: usuarios con la app activada
-- - saldo_admins: quién puede generar y ver códigos
-- - Los datos de la app solo se pueden leer/escribir con licencia activa
-- - Las cuentas que ya existían quedan activadas ("FUNDADOR")

begin;

create table if not exists public.saldo_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.saldo_licencias (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  codigo      text not null,
  activada_en timestamptz not null default now()
);

create table if not exists public.saldo_codigos (
  codigo    text primary key,
  nota      text,
  creado_en timestamptz not null default now(),
  usado_por uuid references auth.users(id) on delete set null,
  usado_en  timestamptz
);
create index if not exists saldo_codigos_libres on public.saldo_codigos (creado_en) where usado_en is null;

alter table public.saldo_admins enable row level security;
alter table public.saldo_licencias enable row level security;
alter table public.saldo_codigos enable row level security;
revoke all on public.saldo_admins, public.saldo_licencias, public.saldo_codigos from anon;
revoke insert, update, delete on public.saldo_admins, public.saldo_licencias, public.saldo_codigos from authenticated;
grant select on public.saldo_admins, public.saldo_licencias, public.saldo_codigos to authenticated;

create or replace function public.saldo_es_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.saldo_admins where user_id = auth.uid())
$$;

create or replace function public.saldo_tiene_licencia() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.saldo_licencias where user_id = auth.uid())
$$;

drop policy if exists propio on public.saldo_admins;
create policy propio on public.saldo_admins for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists propio on public.saldo_licencias;
create policy propio on public.saldo_licencias for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists admin_lee on public.saldo_codigos;
create policy admin_lee on public.saldo_codigos for select to authenticated using ((select public.saldo_es_admin()));

-- Datos de la app: solo los propios y con licencia activa
do $$
declare t text;
begin
  foreach t in array array['saldo_perfiles','saldo_gastos','saldo_ingresos','saldo_fijos','saldo_deudas',
                           'saldo_hijos','saldo_personas','saldo_compartidos','saldo_categorias'] loop
    execute format('drop policy if exists propio on public.%I', t);
    execute format('create policy propio on public.%I for all to authenticated
                      using (user_id = (select auth.uid()) and (select public.saldo_tiene_licencia()))
                      with check (user_id = (select auth.uid()) and (select public.saldo_tiene_licencia()))', t);
  end loop;
end $$;

-- Estado de la cuenta para la app: { licencia, admin }
create or replace function public.saldo_estado() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'licencia', exists (select 1 from public.saldo_licencias where user_id = auth.uid()),
    'admin',    exists (select 1 from public.saldo_admins where user_id = auth.uid())
  )
$$;

-- Activar con un código (cada código sirve una sola vez)
create or replace function public.saldo_activar(p_codigo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_codigo text := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
  v_usado  text;
begin
  if auth.uid() is null then
    raise exception 'no autenticado';
  end if;
  if exists (select 1 from public.saldo_licencias where user_id = auth.uid()) then
    return jsonb_build_object('ok', true, 'ya_activa', true);
  end if;
  -- se compara sin guiones ni espacios: "saldo-ab12 cd34" = "SALDOAB12CD34"
  update public.saldo_codigos
     set usado_por = auth.uid(), usado_en = now()
   where replace(codigo, '-', '') = v_codigo and usado_en is null
  returning codigo into v_usado;
  if v_usado is null then
    return jsonb_build_object('ok', false, 'error',
      case when exists (select 1 from public.saldo_codigos where replace(codigo, '-', '') = v_codigo) then 'usado' else 'invalido' end);
  end if;
  insert into public.saldo_licencias (user_id, codigo) values (auth.uid(), v_usado);
  return jsonb_build_object('ok', true);
end $$;

-- Generar códigos nuevos (solo administradores). Formato: SALDO-XXXX-XXXX sin letras confusas (0/O, 1/I/L)
create or replace function public.saldo_generar_codigos(p_cantidad int default 10, p_nota text default null) returns setof text
language plpgsql security definer set search_path = '' as $$
declare
  alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v text; i int; j int; b bytea;
begin
  if not public.saldo_es_admin() then
    raise exception 'solo administradores';
  end if;
  if p_cantidad < 1 or p_cantidad > 100 then
    raise exception 'cantidad entre 1 y 100';
  end if;
  for i in 1..p_cantidad loop
    loop
      b := extensions.gen_random_bytes(8);
      v := '';
      for j in 0..7 loop
        v := v || substr(alfabeto, (get_byte(b, j) % length(alfabeto)) + 1, 1);
      end loop;
      v := 'SALDO-' || substr(v, 1, 4) || '-' || substr(v, 5, 4);
      exit when not exists (select 1 from public.saldo_codigos where codigo = v);
    end loop;
    insert into public.saldo_codigos (codigo, nota) values (v, p_nota);
    return next v;
  end loop;
end $$;

revoke all on function public.saldo_es_admin(), public.saldo_tiene_licencia(), public.saldo_estado(),
  public.saldo_activar(text), public.saldo_generar_codigos(int, text) from public, anon;
grant execute on function public.saldo_es_admin(), public.saldo_tiene_licencia(), public.saldo_estado(),
  public.saldo_activar(text), public.saldo_generar_codigos(int, text) to authenticated;

-- Cuentas existentes: activadas. Administrador: la cuenta del dueño.
insert into public.saldo_licencias (user_id, codigo)
  select id, 'FUNDADOR' from auth.users on conflict (user_id) do nothing;
insert into public.saldo_admins (user_id)
  select id from auth.users where lower(email) = 'marianoporreca@gmail.com' on conflict do nothing;

commit;
