-- Saldo (app de gastos personales) — estructura inicial
-- Cada usuario ve y modifica solo sus propios datos (RLS por auth.uid()).
-- Borrar el usuario de Auth borra en cascada todos sus datos.

begin;

-- Perfil y configuración (una fila por usuario)
create table if not exists public.saldo_perfiles (
  user_id           uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  nombre            text not null default '',
  sueldo            numeric(14,2) not null default 0 check (sueldo >= 0),
  dia_cobro         smallint not null default 1 check (dia_cobro between 1 and 31),
  estimado_variable numeric(14,2) not null default 0 check (estimado_variable >= 0),
  ahorro_meta       numeric(14,2) not null default 0 check (ahorro_meta >= 0),
  estado_civil      text,
  notif_leidas      jsonb not null default '[]'::jsonb,
  onboarding_ok     boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.saldo_gastos (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  monto      numeric(14,2) not null check (monto > 0),
  concepto   text not null default '',
  categoria  text not null,
  fecha      date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saldo_ingresos (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  monto      numeric(14,2) not null check (monto > 0),
  concepto   text not null default '',
  fecha      date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saldo_fijos (
  id                  uuid primary key,
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre              text not null,
  monto               numeric(14,2) not null check (monto > 0),
  dia_vence           smallint not null check (dia_vence between 1 and 31),
  activo              boolean not null default true,
  ultimo_ciclo_pagado text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.saldo_deudas (
  id                  uuid primary key,
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre              text not null,
  saldo               numeric(14,2) not null default 0 check (saldo >= 0),
  cuota               numeric(14,2) not null check (cuota > 0),
  ultimo_ciclo_pagado text,
  ultimo_pago         numeric(14,2),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.saldo_hijos (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre       text not null,
  edad         smallint not null default 0 check (edad between 0 and 120),
  estudia      boolean not null default false,
  tipo_escuela text check (tipo_escuela in ('publica', 'privada')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.saldo_personas (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre     text not null,
  color      text not null default '#6B7280',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saldo_compartidos (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  persona_id uuid not null references public.saldo_personas(id) on delete cascade,
  monto      numeric(14,2) not null check (monto > 0),
  concepto   text not null default '',
  categoria  text not null,
  fecha      date not null,
  mi_pct     numeric(5,2) not null check (mi_pct between 0 and 100),
  saldado    boolean not null default false,
  pago       text not null default 'me' check (pago in ('me', 'them')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saldo_categorias (
  id         text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre     text not null,
  color      text not null default '#6B7280',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Índices por usuario
create index if not exists saldo_gastos_user_fecha     on public.saldo_gastos (user_id, fecha);
create index if not exists saldo_ingresos_user_fecha   on public.saldo_ingresos (user_id, fecha);
create index if not exists saldo_fijos_user            on public.saldo_fijos (user_id);
create index if not exists saldo_deudas_user           on public.saldo_deudas (user_id);
create index if not exists saldo_hijos_user            on public.saldo_hijos (user_id);
create index if not exists saldo_personas_user         on public.saldo_personas (user_id);
create index if not exists saldo_compartidos_user      on public.saldo_compartidos (user_id);
create index if not exists saldo_compartidos_persona   on public.saldo_compartidos (persona_id);
create index if not exists saldo_categorias_user       on public.saldo_categorias (user_id);

-- updated_at automático
create or replace function public.saldo_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Reglas de acceso: solo los datos propios, solo usuarios logueados
do $$
declare t text;
begin
  foreach t in array array['saldo_perfiles','saldo_gastos','saldo_ingresos','saldo_fijos','saldo_deudas',
                           'saldo_hijos','saldo_personas','saldo_compartidos','saldo_categorias'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists propio on public.%I', t);
    execute format('create policy propio on public.%I for all to authenticated
                      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists saldo_touch on public.%I', t);
    execute format('create trigger saldo_touch before update on public.%I for each row execute function public.saldo_touch()', t);
  end loop;
end $$;

-- Un gasto compartido solo puede apuntar a una persona del mismo usuario
create or replace function public.saldo_compartido_valida() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.saldo_personas p where p.id = new.persona_id and p.user_id = new.user_id) then
    raise exception 'persona inválida';
  end if;
  return new;
end $$;
drop trigger if exists saldo_compartido_valida on public.saldo_compartidos;
create trigger saldo_compartido_valida before insert or update on public.saldo_compartidos
  for each row execute function public.saldo_compartido_valida();

-- Eliminar la propia cuenta (borra el usuario y, en cascada, todos sus datos)
create or replace function public.saldo_borrar_cuenta() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'no autenticado';
  end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.saldo_borrar_cuenta() from public, anon;
grant execute on function public.saldo_borrar_cuenta() to authenticated;

commit;
