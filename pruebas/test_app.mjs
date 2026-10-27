// Prueba de punta a punta de Saldo con un Supabase simulado (Playwright + Chromium)
// Uso: node pruebas/test_app.mjs http://localhost:4173/
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { chromium } = require('/opt/npm-tools/node_modules/playwright')

const BASE = process.argv[2] || 'http://localhost:4173/'
const SUPA = 'https://vcffpaxzehrxkuxdihdd.supabase.co'
const SHOTS = process.argv[3] || '/tmp/saldo_shots'
import fs from 'fs'
fs.mkdirSync(SHOTS, { recursive: true })

let ok = 0, fail = 0
const check = (n, c, x) => { if (c) { ok++; console.log('  ✅', n) } else { fail++; console.log('  ❌', n, x !== undefined ? JSON.stringify(x).slice(0, 300) : '') } }
const esperar = ms => new Promise(r => setTimeout(r, ms))

/* ─── Supabase simulado ─── */
const USER_ID = '9b2f0c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f'
const db = {}                // tabla → Map(clave → fila)
const users = {}             // email → { password, id, nombre }
let offline = false
let licencia = false
const codigosLibres = new Map([['SALDO-ABCD-EFGH', null]])
let restLog = []
const tabla = t => (db[t] ||= new Map())
const session = (u) => ({
  access_token: 'tok-' + u.id, token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'ref-' + u.id,
  user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, user_metadata: { nombre: u.nombre }, identities: [{ id: u.id }], app_metadata: {} },
})
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } })

async function supabaseMock(route) {
  const req = route.request()
  const url = new URL(req.url())
  const method = req.method()
  if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
  if (offline) return route.abort('internetdisconnected')
  const body = req.postData() ? JSON.parse(req.postData()) : null
  const path = url.pathname

  if (path === '/auth/v1/signup') {
    if (users[body.email]) return json(route, 200, { id: users[body.email].id, identities: [] })
    users[body.email] = { id: USER_ID, email: body.email, password: body.password, nombre: body.data?.nombre }
    return json(route, 200, session(users[body.email]))
  }
  if (path === '/auth/v1/token') {
    const u = users[body.email]
    if (!u || u.password !== body.password) return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' })
    return json(route, 200, session(u))
  }
  if (path === '/auth/v1/user') { const u = Object.values(users)[0]; return json(route, 200, session(u).user) }
  if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  if (path === '/auth/v1/recover') return json(route, 200, {})

  if (path === '/rest/v1/rpc/saldo_estado') return json(route, 200, { licencia, admin: true })
  if (path === '/rest/v1/rpc/saldo_activar') {
    const c = String(body.p_codigo).toUpperCase().replace(/[^A-Z0-9]/g, '')
    const k = [...codigosLibres.keys()].find(x => x.replace(/-/g, '') === c)
    if (!k) return json(route, 200, { ok: false, error: 'invalido' })
    if (codigosLibres.get(k)) return json(route, 200, { ok: false, error: 'usado' })
    codigosLibres.set(k, new Date().toISOString()); licencia = true
    return json(route, 200, { ok: true })
  }
  if (path === '/rest/v1/rpc/saldo_generar_codigos') {
    const nuevos = Array.from({ length: body.p_cantidad }, (_, i) => `SALDO-NUEV-${String(codigosLibres.size + i).padStart(4, '2')}`)
    nuevos.forEach(c => codigosLibres.set(c, null))
    return json(route, 200, nuevos)
  }
  if (path === '/rest/v1/saldo_codigos') {
    return json(route, 200, [...codigosLibres.entries()].map(([codigo, usado_en], i) => ({ codigo, nota: null, creado_en: new Date(Date.now() - i * 1000).toISOString(), usado_en })))
  }
  if (path === '/rest/v1/rpc/saldo_borrar_cuenta') {
    licencia = false
    for (const t of Object.keys(db)) db[t].clear()
    for (const k of Object.keys(users)) delete users[k]
    return json(route, 200, null)
  }

  const m = path.match(/^\/rest\/v1\/(\w+)$/)
  if (m) {
    const t = m[1]
    restLog.push({ method, t, body, q: url.search })
    if (method === 'GET') {
      let filas = [...tabla(t).values()]
      const filtro = [...url.searchParams.entries()].find(([k, v]) => v.startsWith('eq.') && k !== 'select')
      if (filtro) filas = filas.filter(f => String(f[filtro[0]]) === filtro[1].slice(3))
      if ((req.headers()['accept'] || '').includes('vnd.pgrst.object')) {
        if (!filas.length) return json(route, 406, { code: 'PGRST116', details: 'The result contains 0 rows', message: 'JSON object requested, multiple (or no) rows returned' })
        return json(route, 200, filas[0])
      }
      return json(route, 200, filas)
    }
    if (method === 'POST') {
      const clave = url.searchParams.get('on_conflict') || 'id'
      const filas = Array.isArray(body) ? body : [body]
      for (const f of filas) {
        const fila = { user_id: USER_ID, created_at: new Date().toISOString(), ...tabla(t).get(f[clave] ?? USER_ID), ...f }
        tabla(t).set(String(fila[clave] ?? USER_ID), fila)
      }
      return json(route, 201, undefined)
    }
    if (method === 'DELETE') {
      const [k, v] = [...url.searchParams.entries()].find(([, v]) => v.startsWith('eq.'))
      for (const [key, f] of tabla(t)) if (String(f[k]) === v.slice(3)) tabla(t).delete(key)
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    }
  }
  return json(route, 404, { message: 'no simulado: ' + path })
}

/* ─── Recorrido ─── */
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', permissions: ['clipboard-read', 'clipboard-write'] })
await ctx.route(SUPA + '/**', supabaseMock)
await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
const page = await ctx.newPage()
const errores = []
page.on('pageerror', e => errores.push(e.message))
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::/.test(m.text())) errores.push(m.text()) })
const shot = async n => page.screenshot({ path: `${SHOTS}/${n}.png` })
const txt = async () => page.locator('body').innerText()

console.log('\n▶ Ingreso y registro')
await page.goto(BASE)
await page.getByText('Bienvenido').waitFor()
check('Abre en la pantalla de ingreso', true)
await shot('01_ingreso')
await page.getByRole('button', { name: 'Ingresar' }).click()
check('Valida email vacío', (await txt()).includes('Ingresá un email válido'))
await page.getByLabel('Email').fill('ana@mail.com')
await page.getByLabel('Contraseña').fill('cualquiera1')
await page.getByRole('button', { name: 'Ingresar' }).click()
await page.getByText('Email o contraseña incorrectos').waitFor()
check('Cuenta inexistente: mensaje claro', true)
await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click()
await page.getByRole('button', { name: 'Enviar link' }).click()
await page.getByText('Si hay una cuenta con ese email').waitFor()
check('Recuperar contraseña manda el link', true)
await page.getByRole('button', { name: 'Volver a ingresar' }).click()
await page.getByRole('button', { name: 'Registrate' }).click()
await page.getByLabel('Tu nombre').fill('Ana')
await page.getByLabel('Email').fill('ana@mail.com')
await page.getByLabel('Contraseña').fill('corta')
await page.getByRole('button', { name: 'Crear cuenta' }).click()
check('Pide contraseña de 8 con letras y números', (await txt()).includes('al menos 8 caracteres'))
await page.getByLabel('Contraseña').fill('Segura123')
await page.getByRole('button', { name: 'Crear cuenta' }).click()
await page.getByText('Activá tu cuenta').waitFor()
check('Cuenta nueva sin código: pide activación antes de usar la app', true)
await shot('00_activacion')
await page.getByLabel('Código de activación').fill('SALDO-XXXX-YYYY')
await page.getByRole('button', { name: 'Activar' }).click()
await page.getByText('Ese código no existe').waitFor()
check('Código inválido: mensaje claro', true)
await page.getByLabel('Código de activación').fill('saldo abcd efgh')
await page.getByRole('button', { name: 'Activar' }).click()
await page.getByText('Paso 1 de 6').waitFor()
check('Código válido (escrito en minúscula y sin guiones): pasa a la configuración', true)
check('Registro lleva a la configuración inicial', true)

console.log('\n▶ Configuración inicial (montos con punto de miles)')
await page.getByLabel('Sueldo neto mensual').fill('1.000.000')
await page.getByLabel('Día de cobro').fill('5')
await shot('02_onboarding_sueldo')
await page.getByRole('button', { name: 'Continuar' }).click()
await page.getByText('Paso 2 de 6').waitFor()
await page.getByLabel('Nombre').fill('Alquiler')
await page.getByLabel('Monto').fill('300.000')
await page.getByLabel('Día vence').fill('1')
await page.getByRole('button', { name: '+ Agregar' }).click()
check('Fijo agregado con monto $ 300.000', (await txt()).includes('300.000'))
await page.getByRole('button', { name: 'Continuar' }).click()
await page.getByLabel('Estimado mensual').fill('300.000')
await page.getByRole('button', { name: 'Continuar' }).click()
await page.getByText('Paso 4 de 6').waitFor()
await page.getByRole('button', { name: 'Continuar' }).click()
await page.getByText('Paso 5 de 6').waitFor()
check('El paso de familia dice que es opcional', (await txt()).includes('opcional'))
await page.getByRole('button', { name: 'Continuar' }).click()
check('El nombre del registro ya viene cargado', await page.getByLabel('Tu nombre').inputValue() === 'Ana')
await page.getByLabel('Meta de ahorro mensual (opcional)').fill('100.000')
await page.getByRole('button', { name: 'Finalizar' }).click()
await page.getByText('Podés gastar hoy').waitFor()
check('Termina en el inicio', true)
await esperar(1500)
const perfil = tabla('saldo_perfiles').get(USER_ID)
check('Perfil guardado en la base: sueldo 1.000.000, cobro día 5', perfil && Number(perfil.sueldo) === 1000000 && perfil.dia_cobro === 5, perfil)
check('Estimado 300.000 y ahorro 100.000 guardados', perfil && perfil.estimado_variable === 300000 && perfil.ahorro_meta === 100000, perfil)
check('Configuración inicial marcada como terminada', perfil?.onboarding_ok === true)
check('Gasto fijo guardado en la base', [...tabla('saldo_fijos').values()].some(f => f.nombre === 'Alquiler' && f.monto === 300000))

console.log('\n▶ Cálculo del disponible')
const hero = await page.locator('text=Podés gastar hoy').locator('xpath=following-sibling::div[1]').innerText()
// mismo cálculo que la app: 300.000 / días hasta el próximo cobro (día 5)
const hoy = new Date(); const d = hoy.getDate()
const prox = d >= 5 ? new Date(hoy.getFullYear(), hoy.getMonth() + 1, 5) : new Date(hoy.getFullYear(), hoy.getMonth(), 5)
const dias = Math.max(1, Math.round((prox - new Date(hoy.getFullYear(), hoy.getMonth(), d)) / 86400000))
const esperado = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(300000 / dias)
check(`"Podés gastar hoy" = 300.000 / ${dias} días = ${esperado}`, hero.replace(/\s/g, ' ').trim() === esperado.replace(/\s/g, ' '), hero)
await shot('03_inicio')

console.log('\n▶ Gastos e ingresos')
await page.getByRole('button', { name: 'Agregar gasto o ingreso' }).click()
await page.getByLabel('Monto').fill('1.500')
await page.getByRole('button', { name: 'Comida' }).click()
await page.getByLabel('Descripción').fill('Almuerzo')
await shot('04_nuevo_gasto')
await page.getByRole('button', { name: 'Guardar', exact: true }).click()
await page.getByText('Almuerzo').waitFor()
await esperar(1200)
const g = [...tabla('saldo_gastos').values()][0]
check('Gasto de $1.500 guardado (no $1,5)', g && g.monto === 1500 && g.categoria === 'comida', g)
const hero2 = await page.locator('text=Podés gastar hoy').locator('xpath=following-sibling::div[1]').innerText()
const esperado2 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(300000 / dias - 1500)
check('El disponible baja exactamente $1.500', hero2.replace(/\s/g, ' ').trim() === esperado2.replace(/\s/g, ' '), [hero2, esperado2])
await page.getByRole('button', { name: 'Agregar gasto o ingreso' }).click()
await page.getByRole('button', { name: 'Ingreso extra' }).click()
await page.getByLabel('Monto').fill('50.000')
await page.getByLabel('Descripción').fill('Changa')
await page.getByRole('button', { name: 'Guardar', exact: true }).click()
await page.getByText('Changa').waitFor()
await esperar(1200)
check('Ingreso extra guardado', [...tabla('saldo_ingresos').values()].some(i => i.monto === 50000))
check('Se muestra en verde con +', (await txt()).includes('+$') || (await txt()).includes('+ $'))
await page.getByRole('button', { name: 'Editar Almuerzo' }).click()
await page.getByLabel('Monto').fill('2.000')
await page.getByRole('button', { name: 'Guardar cambios' }).click()
await esperar(1200)
check('Editar actualiza en la base', [...tabla('saldo_gastos').values()][0].monto === 2000)

console.log('\n▶ Sin conexión')
offline = true
await ctx.setOffline(true)
await page.getByRole('button', { name: 'Agregar gasto o ingreso' }).click()
await page.getByLabel('Monto').fill('800')
await page.getByLabel('Descripción').fill('Café sin señal')
await page.getByRole('button', { name: 'Guardar', exact: true }).click()
await page.getByText('Café sin señal').waitFor()
await esperar(1500)
check('Sin conexión el gasto aparece igual', true)
check('Avisa que se guarda al volver', (await txt()).includes('Sin conexión'), (await txt()).slice(0, 200))
check('Todavía no llegó a la base', ![...tabla('saldo_gastos').values()].some(x => x.concepto === 'Café sin señal'))
await shot('05_sin_conexion')
offline = false
await ctx.setOffline(false)
await page.evaluate(() => window.dispatchEvent(new Event('online')))
await esperar(2500)
check('Al volver la conexión se sube solo', [...tabla('saldo_gastos').values()].some(x => x.concepto === 'Café sin señal'))
check('Desaparece el aviso', !(await txt()).includes('Sin conexión'))

console.log('\n▶ Modo oscuro y pantallas')
await page.getByRole('button', { name: 'Activar modo oscuro' }).click()
await esperar(400)
await shot('06_inicio_oscuro')
const colorBoton = await page.evaluate(() => {
  document.querySelector('[aria-label="Agregar gasto o ingreso"]').click()
  return new Promise(r => setTimeout(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Guardar'); r(getComputedStyle(b).color) }, 400))
})
check('En oscuro el botón principal tiene texto oscuro sobre ámbar', colorBoton === 'rgb(43, 47, 54)', colorBoton)
await shot('07_modal_oscuro')
await page.getByRole('button', { name: 'Cerrar' }).click()
await page.getByRole('button', { name: 'Más opciones' }).click()
check('El menú muestra el email', (await txt()).includes('ana@mail.com'))
await shot('12_menu')
check('El menú ofrece instalar la app solo donde se puede (no en este navegador de prueba)', !(await txt()).includes('Instalar app en el celular'))
await page.locator('.drawer-in').getByRole('button', { name: 'Reportes' }).click()
await page.getByText('Últimos 7 días').waitFor()
await page.getByRole('button', { name: 'Ciclo' }).click()
const rep = await txt()
check('Reportes: estructura con ingresos extra y "Día a día"', rep.includes('Ingresos extra') && rep.includes('Día a día') && rep.includes('Libre'))
await shot('08_reportes_oscuro')
await page.goBack()
await page.getByText('Podés gastar hoy').waitFor()
check('El botón "atrás" vuelve al inicio (no sale de la app)', true)
await page.getByRole('button', { name: 'Activar modo claro' }).click()

console.log('\n▶ Barra inferior')
await page.getByRole('navigation').getByRole('button', { name: 'Historial' }).click()
await page.getByRole('heading', { name: 'Historial' }).or(page.getByText('Historial', { exact: true }).first()).waitFor()
check('La barra lleva al historial', (await txt()).includes('Hoy'))
await shot('10_historial')
await page.getByRole('navigation').getByRole('button', { name: 'Reportes' }).click()
await page.getByText('Últimos 7 días').waitFor()
check('La barra lleva a reportes', true)
await page.getByRole('navigation').getByRole('button', { name: 'Inicio' }).click()
await page.getByText('Podés gastar hoy').waitFor()
check('La barra vuelve al inicio', true)
await page.getByRole('navigation').getByRole('button', { name: 'Historial' }).click()
await esperar(300)
await page.goBack()
await page.getByText('Podés gastar hoy').waitFor()
check('Desde Historial, "atrás" vuelve al inicio', page.url().startsWith(BASE))
await page.getByRole('button', { name: 'Editar Almuerzo' }).click()
check('Al editar, la fecha "Hoy" viene marcada', await page.getByRole('button', { name: 'Hoy' }).getAttribute('aria-pressed') === 'true')
await page.getByRole('button', { name: 'Ayer' }).click()
await page.getByRole('button', { name: 'Guardar cambios' }).click()
await esperar(1200)
const ayerK = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()
check('Cambiar a "Ayer" guarda la fecha de ayer', [...tabla('saldo_gastos').values()].find(x => x.concepto === 'Almuerzo')?.fecha === ayerK)
check('Y sale de los movimientos de hoy', !(await txt()).includes('Almuerzo'))
await page.getByRole('navigation').getByRole('button', { name: 'Historial' }).click()
await page.getByRole('button', { name: 'Editar Almuerzo' }).click()
await page.getByRole('button', { name: 'Hoy' }).click()
await page.getByRole('button', { name: 'Guardar cambios' }).click()
await esperar(1000)
await page.getByRole('navigation').getByRole('button', { name: 'Inicio' }).click()
await page.getByText('Almuerzo').waitFor()

console.log('\n▶ Compartidos e importación')
await page.getByRole('button', { name: 'Más opciones' }).click()
await page.getByRole('button', { name: 'Compartidos' }).click()
await page.getByRole('button', { name: '+ Persona' }).click()
await page.getByPlaceholder('Nombre').fill('Tati')
await page.getByRole('button', { name: 'OK' }).click()
await page.getByLabel('Monto').fill('10.000')
await page.getByLabel('Mi %').fill('40')
await page.getByLabel('Concepto').fill('Cena')
await shot('13_compartidos')
await page.getByRole('button', { name: 'Guardar gasto' }).click()
await esperar(1500)
const comp = [...tabla('saldo_compartidos').values()][0]
const pers = [...tabla('saldo_personas').values()][0]
check('Persona y gasto compartido guardados y vinculados', comp && pers && comp.persona_id === pers.id && comp.monto === 10000 && comp.mi_pct === 40, comp)
check('Persona guardada antes que el gasto (orden de la cola)', restLog.findIndex(x => x.t === 'saldo_personas') < restLog.findIndex(x => x.t === 'saldo_compartidos'))
await page.getByRole('button', { name: 'Volver' }).click()
await page.getByRole('button', { name: 'Más opciones' }).click()
await page.getByRole('button', { name: 'Importar extracto' }).click()
const csv = 'Fecha;Descripción;Importe\n' + `${hoy.getDate()}/${hoy.getMonth() + 1}/${hoy.getFullYear()};SUPERMERCADO COTO;-4.350,00\n` + `${hoy.getDate()}/${hoy.getMonth() + 1}/${hoy.getFullYear()};REINTEGRO OSDE;12.000,00\n`
await page.locator('input[type=file]').setInputFiles({ name: 'extracto.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
await page.getByText('2 movimientos').waitFor()
await page.getByRole('button', { name: 'Créditos' }).click()
await page.getByRole('button', { name: 'Elegir REINTEGRO OSDE' }).click()
await page.getByRole('button', { name: /Importar 2 movimientos/ }).click()
await page.getByText('¡Listo!').waitFor()
await esperar(1500)
check('Importa el débito como gasto ($4.350)', [...tabla('saldo_gastos').values()].some(x => x.monto === 4350 && x.categoria === 'comida'))
check('Importa el crédito elegido como ingreso ($12.000)', [...tabla('saldo_ingresos').values()].some(x => x.monto === 12000))
await page.getByRole('button', { name: 'Volver al inicio' }).click()

console.log('\n▶ Códigos de activación (administrador)')
await page.getByRole('button', { name: 'Más opciones' }).click()
await page.locator('.drawer-in').getByRole('button', { name: 'Códigos de activación' }).click()
await page.getByText('Disponibles', { exact: true }).waitFor()
check('El administrador ve la pantalla de códigos', true)
await page.getByRole('button', { name: '+ 1 código' }).click()
await page.getByText('SALDO-NUEV-').first().waitFor()
check('Genera un código nuevo y aparece en la lista', true)
await shot('14_codigos')
await page.getByRole('button', { name: 'Copiar mensaje' }).first().click()
const portapapeles = await page.evaluate(() => navigator.clipboard.readText())
check('"Copiar mensaje" copia el código, el link y los pasos', /SALDO-NUEV-\d+/.test(portapapeles) && portapapeles.includes('online-m-glitch.github.io/saldo-app') && portapapeles.includes('Registrate'), portapapeles.slice(0, 120))
check('El código usado no aparece como disponible', !(await txt()).includes('SALDO-ABCD-EFGH'))
await page.getByRole('button', { name: 'Volver' }).click()

console.log('\n▶ Volver a entrar (datos desde la nube)')
await page.getByRole('button', { name: 'Más opciones' }).click()
await page.getByRole('button', { name: 'Cerrar sesión' }).click()
await page.getByText('Bienvenido').waitFor()
check('Cerrar sesión vuelve al ingreso', true)
check('Al salir se borra la copia local', await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('saldo:cache') || k.startsWith('saldo:cola')).length) === 0)
await page.getByLabel('Email').fill('ana@mail.com')
await page.getByLabel('Contraseña').fill('Segura123')
await page.getByRole('button', { name: 'Ingresar' }).click()
await page.getByText('Podés gastar hoy').waitFor()
await page.getByText('Almuerzo').waitFor()
const t2 = await txt()
check('Vuelve con los gastos e ingresos desde la base', t2.includes('Almuerzo') && t2.includes('Café sin señal') && t2.includes('Changa'))
check('No vuelve a pedir la configuración inicial', !t2.includes('Paso 1 de 6'))

console.log('\n▶ Perfil y borrar cuenta')
await page.getByRole('button', { name: 'Más opciones' }).click()
await page.getByRole('button', { name: 'Perfil' }).click()
await page.getByLabel('Sueldo neto mensual').fill('1.200.000')
await page.getByRole('button', { name: 'Guardar cambios' }).click()
await esperar(1500)
check('Perfil actualizado en la base (1.200.000)', tabla('saldo_perfiles').get(USER_ID)?.sueldo === 1200000)
await page.getByRole('button', { name: 'Más opciones' }).click()
await page.getByRole('button', { name: 'Perfil' }).click()
await shot('09_perfil')
await page.getByRole('button', { name: 'Eliminar mi cuenta' }).click()
await page.getByRole('button', { name: 'Eliminar todo' }).click()
await page.getByText('Bienvenido').waitFor()
check('Borrar cuenta: vuelve al ingreso y no quedan datos', tabla('saldo_gastos').size === 0 && tabla('saldo_perfiles').size === 0)

check('Sin errores de JavaScript en todo el recorrido', errores.length === 0, errores)

console.log('\n▶ Aviso para instalar en el celular')
for (const [nombre, ua, espera] of [
  ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'Agregar a inicio'],
  ['Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36', 'Instalar app'],
]) {
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, userAgent: ua, isMobile: true, hasTouch: true, locale: 'es-AR' })
  await c2.route(SUPA + '/**', supabaseMock)
  await c2.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  const p2 = await c2.newPage()
  await p2.goto(BASE)
  const visto = await p2.getByText('Instalá Saldo en tu celular').waitFor({ timeout: 8000 }).then(() => true).catch(() => false)
  check(`${nombre}: aparece el aviso para instalar`, visto)
  check(`${nombre}: muestra cómo hacerlo (${espera})`, (await p2.locator('body').innerText()).includes(espera))
  await p2.screenshot({ path: `${SHOTS}/11_instalar_${nombre.toLowerCase()}.png` })
  await p2.getByRole('button', { name: /Entendido|Ahora no/ }).click()
  await esperar(300)
  check(`${nombre}: se cierra`, !(await p2.locator('body').innerText()).includes('Instalá Saldo en tu celular'))
  await p2.reload()
  await esperar(4500)
  check(`${nombre}: no vuelve a molestar después de cerrarlo`, !(await p2.locator('body').innerText()).includes('Instalá Saldo en tu celular'))
  await c2.close()
}
await browser.close()
console.log(`\nResultado: ${ok} bien, ${fail} mal`)
process.exit(fail ? 1 : 0)
