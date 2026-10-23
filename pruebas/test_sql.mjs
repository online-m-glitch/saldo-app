import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite()
let ok = 0, fail = 0
const check = (n, c, x) => { if (c) { ok++; console.log('  ✅', n) } else { fail++; console.log('  ❌', n, x ?? '') } }
const tryq = async (sql, params) => { try { return { r: await db.query(sql, params) } } catch (e) { return { e: e.message } } }

// Simulación mínima de Supabase: esquema auth, auth.uid(), roles anon/authenticated
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  -- en Supabase, los roles del Data API tienen permisos por defecto en public
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
  insert into auth.users values ('11111111-1111-4111-8111-111111111111','a@x.com'), ('22222222-2222-4222-8222-222222222222','b@x.com');
`)
const sql = fs.readFileSync('base_de_datos/001_saldo_inicial.sql', 'utf8')
const tryx = async (q) => { try { await db.exec(q); return {} } catch (e) { return { e: e.message } } }
const m = await tryx(sql)
check('La migración corre sin errores', !m.e, m.e)
const m2 = await tryx(sql)
check('Se puede correr dos veces (no rompe si ya existe)', !m2.e, m2.e)

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'
const como = async (rol, uid, q, params) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${rol};`)
  const res = await tryq(q, params)
  await db.exec('reset role')
  return res
}
const g1 = '33333333-3333-4333-8333-333333333333'
let r = await como('authenticated', A, `insert into saldo_gastos (id, monto, categoria, fecha) values ('${g1}', 1500, 'comida', '2026-10-22') returning user_id`)
check('Usuario A crea un gasto y queda a su nombre', r.r?.rows[0]?.user_id === A, r.e)
r = await como('authenticated', B, `select * from saldo_gastos`)
check('Usuario B no ve los gastos de A', r.r?.rows.length === 0, r)
r = await como('authenticated', B, `update saldo_gastos set monto = 1 where id = '${g1}' returning id`)
check('B no puede modificar el gasto de A', (r.r?.rows.length ?? 0) === 0)
r = await como('authenticated', B, `delete from saldo_gastos where id = '${g1}' returning id`)
check('B no puede borrar el gasto de A', (r.r?.rows.length ?? 0) === 0)
r = await como('authenticated', B, `insert into saldo_gastos (id, user_id, monto, categoria, fecha) values (gen_random_uuid(), '${A}', 5, 'otros', '2026-10-22')`)
check('B no puede crear gastos a nombre de A', !!r.e, r)
r = await como('anon', null, `select * from saldo_gastos`)
check('Sin sesión no se ve nada', !!r.e || r.r.rows.length === 0, r)
r = await como('anon', null, `insert into saldo_perfiles (user_id) values ('${A}')`)
check('Sin sesión no se puede escribir', !!r.e)
r = await como('authenticated', A, `insert into saldo_perfiles (nombre, sueldo, dia_cobro) values ('Ana', 850000, 5) on conflict (user_id) do update set sueldo = excluded.sueldo returning user_id`)
check('A guarda su perfil (upsert)', r.r?.rows[0]?.user_id === A, r.e)
r = await como('authenticated', A, `insert into saldo_perfiles (nombre, sueldo, dia_cobro) values ('Ana', 900000, 5) on conflict (user_id) do update set sueldo = excluded.sueldo returning sueldo`)
check('El upsert del perfil actualiza', Number(r.r?.rows[0]?.sueldo) === 900000, r.e)
r = await como('authenticated', A, `insert into saldo_gastos (id, monto, categoria, fecha) values (gen_random_uuid(), -5, 'comida', '2026-10-22')`)
check('No acepta montos negativos', !!r.e)
r = await como('authenticated', A, `insert into saldo_perfiles (nombre, dia_cobro) values ('x', 40) on conflict (user_id) do update set dia_cobro = excluded.dia_cobro`)
check('No acepta día de cobro 40', !!r.e)
// compartidos: persona de otro usuario
const pB = '44444444-4444-4444-8444-444444444444'
await como('authenticated', B, `insert into saldo_personas (id, nombre) values ('${pB}', 'Tati')`)
r = await como('authenticated', A, `insert into saldo_compartidos (id, persona_id, monto, categoria, fecha, mi_pct) values (gen_random_uuid(), '${pB}', 100, 'ocio', '2026-10-22', 50)`)
check('A no puede colgar un compartido de una persona de B', !!r.e, r)
const pA = '55555555-5555-4555-8555-555555555555'
await como('authenticated', A, `insert into saldo_personas (id, nombre) values ('${pA}', 'Marian')`)
r = await como('authenticated', A, `insert into saldo_compartidos (id, persona_id, monto, categoria, fecha, mi_pct, pago) values (gen_random_uuid(), '${pA}', 100, 'ocio', '2026-10-22', 50, 'them')`)
check('A sí puede con su propia persona', !r.e, r.e)
// updated_at
await new Promise(res => setTimeout(res, 20))
r = await como('authenticated', A, `update saldo_gastos set monto = 2000 where id = '${g1}' returning created_at < updated_at as cambio`)
check('updated_at se actualiza solo', r.r?.rows[0]?.cambio === true, r)
// borrar cuenta
r = await como('anon', null, `select saldo_borrar_cuenta()`)
check('Sin sesión no se puede borrar una cuenta', !!r.e)
r = await como('authenticated', A, `select saldo_borrar_cuenta()`)
check('A borra su cuenta', !r.e, r.e)
const quedan = await db.query(`select (select count(*) from auth.users where id = '${A}') u, (select count(*) from saldo_gastos where user_id = '${A}') g, (select count(*) from saldo_perfiles where user_id = '${A}') p, (select count(*) from saldo_compartidos where user_id = '${A}') c, (select count(*) from auth.users) total`)
const q = quedan.rows[0]
check('Se borra el usuario y todos sus datos en cascada', Number(q.u) === 0 && Number(q.g) === 0 && Number(q.p) === 0 && Number(q.c) === 0, q)
check('B sigue existiendo', Number(q.total) === 1)
console.log(`\nResultado: ${ok} bien, ${fail} mal`)
process.exit(fail ? 1 : 0)
