import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const db = new PGlite()
let ok = 0, fail = 0
const check = (n, c, x) => { if (c) { ok++; console.log('  ✅', n) } else { fail++; console.log('  ❌', n, x === undefined ? '' : JSON.stringify(x)) } }
const q = async (sql) => { try { return { r: await db.query(sql) } } catch (e) { return { e: e.message } } }
const ex = async (sql) => { try { await db.exec(sql); return {} } catch (e) { return { e: e.message } } }
await db.exec(`
  create schema auth; create schema extensions;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function extensions.gen_random_bytes(n int) returns bytea language sql volatile as $$ select substring(decode(md5(random()::text || clock_timestamp()::text), 'hex') from 1 for n) $$;
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public, auth, extensions to anon, authenticated;
  grant execute on all functions in schema auth, extensions to anon, authenticated;
  alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
`)
const MARIANO = '11111111-1111-4111-8111-111111111111', VIEJO = '22222222-2222-4222-8222-222222222222'
const NUEVO = '33333333-3333-4333-8333-333333333333', OTRO = '44444444-4444-4444-8444-444444444444'
await db.exec(`insert into auth.users values ('${MARIANO}','MarianoPorreca@gmail.com'),('${VIEJO}','viejo@x.com')`)
check('Migración 001', !(await ex(fs.readFileSync('base_de_datos/001_saldo_inicial.sql', 'utf8'))).e)
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${VIEJO}',false);
  insert into saldo_gastos (id, monto, categoria, fecha) values (gen_random_uuid(), 100, 'comida', '2026-10-01'); reset role;`)
const m2 = await ex(fs.readFileSync('base_de_datos/002_codigos_activacion.sql', 'utf8'))
check('Migración 002 corre', !m2.e, m2.e)
check('Migración 002 se puede repetir', !(await ex(fs.readFileSync('base_de_datos/002_codigos_activacion.sql', 'utf8'))).e)
await db.exec(`insert into auth.users values ('${NUEVO}','nuevo@x.com'),('${OTRO}','otro@x.com')`)

const como = async (uid, sql) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${uid ? 'authenticated' : 'anon'};`)
  const r = await q(sql); await db.exec('reset role'); return r
}
let r = await como(VIEJO, `select saldo_estado() e`)
check('Cuenta existente queda activada (fundador)', r.r?.rows[0].e.licencia === true, r)
r = await como(VIEJO, `select count(*)::int n from saldo_gastos`)
check('Cuenta existente sigue viendo sus gastos', r.r?.rows[0].n === 1, r)
r = await como(MARIANO, `select saldo_estado() e`)
check('Mariano es administrador (email sin importar mayúsculas)', r.r?.rows[0].e.admin === true && r.r.rows[0].e.licencia === true, r)
r = await como(VIEJO, `select saldo_estado() e`)
check('Otra cuenta no es administradora', r.r?.rows[0].e.admin === false)

r = await como(NUEVO, `select saldo_estado() e`)
check('Cuenta nueva: sin licencia', r.r?.rows[0].e.licencia === false)
r = await como(NUEVO, `insert into saldo_perfiles (nombre, dia_cobro) values ('x', 5)`)
check('Sin licencia no puede guardar datos', !!r.e)
r = await como(NUEVO, `select count(*)::int n from saldo_gastos`)
check('Sin licencia no ve nada', r.r?.rows[0].n === 0)
r = await como(NUEVO, `select saldo_generar_codigos(5)`)
check('No administrador no puede generar códigos', !!r.e)
r = await como(NUEVO, `insert into saldo_licencias (user_id, codigo) values ('${NUEVO}', 'TRUCHO')`)
check('No se puede autoactivar insertando la licencia', !!r.e)
r = await como(NUEVO, `select saldo_activar('SALDO-AAAA-BBBB') a`)
check('Código inexistente: rechazado', r.r?.rows[0].a.ok === false && r.r.rows[0].a.error === 'invalido', r)

r = await como(MARIANO, `select saldo_generar_codigos(3, 'venta prueba') c`)
const codigos = r.r?.rows.map(x => x.c) ?? []
check('Admin genera 3 códigos con formato SALDO-XXXX-XXXX', codigos.length === 3 && codigos.every(c => /^SALDO-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(c)), codigos)
r = await como(MARIANO, `select count(*)::int n from saldo_codigos where usado_en is null`)
check('Admin ve los códigos libres', r.r?.rows[0].n === 3)
r = await como(NUEVO, `select count(*)::int n from saldo_codigos`)
check('Un usuario común no ve los códigos', r.r?.rows[0].n === 0)

const escrito = codigos[0].toLowerCase().replace(/-/g, ' ')
r = await como(NUEVO, `select saldo_activar('${escrito}') a`)
check('Activa con el código aunque lo escriba en minúscula y sin guiones', r.r?.rows[0].a.ok === true, r)
r = await como(NUEVO, `insert into saldo_perfiles (nombre, dia_cobro) values ('Nuevo', 5) returning user_id`)
check('Con licencia ya puede guardar', r.r?.rows[0]?.user_id === NUEVO, r.e)
r = await como(OTRO, `select saldo_activar('${codigos[0]}') a`)
check('El mismo código no sirve dos veces', r.r?.rows[0].a.ok === false && r.r.rows[0].a.error === 'usado', r)
r = await como(OTRO, `select saldo_activar('${codigos[1]}') a`)
check('Otro código libre sí sirve', r.r?.rows[0].a.ok === true)
r = await como(MARIANO, `select count(*)::int n from saldo_codigos where usado_en is null`)
check('Quedan 1 libre', r.r?.rows[0].n === 1)
r = await como(null, `select saldo_activar('${codigos[2]}')`)
check('Sin sesión no se puede activar', !!r.e)

// borrar cuenta: se va la licencia, el código queda marcado como usado
await como(OTRO, `select saldo_borrar_cuenta()`)
r = await q(`select (select count(*)::int from saldo_licencias where user_id='${OTRO}') l, (select usado_en is not null from saldo_codigos where codigo='${codigos[1]}') u`)
check('Al borrar la cuenta se va la licencia y el código no se puede reusar', r.r?.rows[0].l === 0 && r.r.rows[0].u === true, r)
console.log(`\nResultado: ${ok} bien, ${fail} mal`)
process.exit(fail ? 1 : 0)
