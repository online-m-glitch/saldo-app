/*
 * Datos del usuario en la nube (Supabase) con copia local.
 *
 * - Al entrar se muestra al instante la copia guardada en el dispositivo y después se trae lo de la base.
 * - Cada cambio se guarda primero en el dispositivo y se anota en una cola; la cola se sube a la base
 *   apenas hay conexión. Si no hay señal, los cambios esperan y se suben solos cuando vuelve.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import {
  PERFIL_VACIO,
  type Category, type Child, type Debt, type Expense, type FixedExpense, type Income,
  type Perfil, type SharedExpense, type SharedPerson,
} from './calc'

type Row = Record<string, unknown>

export interface Datos {
  perfil: Perfil
  expenses: Expense[]
  incomes: Income[]
  fixedExpenses: FixedExpense[]
  debts: Debt[]
  children: Child[]
  people: SharedPerson[]
  shared: SharedExpense[]
  categories: Category[]
}
export type ListaKey = Exclude<keyof Datos, 'perfil'>

export const DATOS_VACIOS: Datos = {
  perfil: PERFIL_VACIO, expenses: [], incomes: [], fixedExpenses: [], debts: [],
  children: [], people: [], shared: [], categories: [],
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const optStr = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : String(v))
const optNum = (v: unknown) => (v === null || v === undefined ? undefined : Number(v))

/* Correspondencia entre los objetos de la app y las filas de la base */
const TABLAS: { [K in ListaKey]: { tabla: string; to: (x: Datos[K][number]) => Row; from: (r: Row) => Datos[K][number] } } = {
  expenses: {
    tabla: 'saldo_gastos',
    to: e => ({ id: e.id, monto: e.amount, concepto: e.concept, categoria: e.category, fecha: e.date }),
    from: r => ({ id: String(r.id), amount: num(r.monto), concept: String(r.concepto ?? ''), category: String(r.categoria), date: String(r.fecha) }),
  },
  incomes: {
    tabla: 'saldo_ingresos',
    to: i => ({ id: i.id, monto: i.amount, concepto: i.concept, fecha: i.date }),
    from: r => ({ id: String(r.id), amount: num(r.monto), concept: String(r.concepto ?? ''), date: String(r.fecha) }),
  },
  fixedExpenses: {
    tabla: 'saldo_fijos',
    to: f => ({ id: f.id, nombre: f.name, monto: f.amount, dia_vence: f.dueDay, activo: f.active, ultimo_ciclo_pagado: f.lastPaidCycle ?? null }),
    from: r => ({ id: String(r.id), name: String(r.nombre), amount: num(r.monto), dueDay: num(r.dia_vence), active: Boolean(r.activo), lastPaidCycle: optStr(r.ultimo_ciclo_pagado) }),
  },
  debts: {
    tabla: 'saldo_deudas',
    to: d => ({ id: d.id, nombre: d.name, saldo: d.balance, cuota: d.monthlyPayment, ultimo_ciclo_pagado: d.lastPaidCycle ?? null, ultimo_pago: d.lastPaymentAmount ?? null }),
    from: r => ({ id: String(r.id), name: String(r.nombre), balance: num(r.saldo), monthlyPayment: num(r.cuota), lastPaidCycle: optStr(r.ultimo_ciclo_pagado), lastPaymentAmount: optNum(r.ultimo_pago) }),
  },
  children: {
    tabla: 'saldo_hijos',
    to: c => ({ id: c.id, nombre: c.name, edad: c.age, estudia: c.studies, tipo_escuela: c.schoolType }),
    from: r => ({ id: String(r.id), name: String(r.nombre), age: num(r.edad), studies: Boolean(r.estudia), schoolType: (r.tipo_escuela as Child['schoolType']) ?? null }),
  },
  people: {
    tabla: 'saldo_personas',
    to: p => ({ id: p.id, nombre: p.name, color: p.color }),
    from: r => ({ id: String(r.id), name: String(r.nombre), color: String(r.color ?? '#6B7280') }),
  },
  shared: {
    tabla: 'saldo_compartidos',
    to: s => ({ id: s.id, persona_id: s.sharedPersonId, monto: s.amount, concepto: s.concept, categoria: s.category, fecha: s.date, mi_pct: s.myPercentage, saldado: s.settled, pago: s.paidBy }),
    from: r => ({ id: String(r.id), sharedPersonId: String(r.persona_id), amount: num(r.monto), concept: String(r.concepto ?? ''), category: String(r.categoria), date: String(r.fecha), myPercentage: num(r.mi_pct), settled: Boolean(r.saldado), paidBy: r.pago === 'them' ? 'them' : 'me' }),
  },
  categories: {
    tabla: 'saldo_categorias',
    to: c => ({ id: c.id, nombre: c.label, color: c.color }),
    from: r => ({ id: String(r.id), label: String(r.nombre), color: String(r.color ?? '#6B7280') }),
  },
}

const PERFIL_TABLA = 'saldo_perfiles'
const perfilToRow = (p: Perfil, userId: string): Row => ({
  user_id: userId, nombre: p.name, sueldo: p.salary, dia_cobro: p.payday,
  estimado_variable: p.varEstimate, ahorro_meta: p.savingsGoal, estado_civil: p.marital,
  notif_leidas: p.readIds.slice(-300), onboarding_ok: p.onboardingDone,
})
const perfilFromRow = (r: Row): Perfil => ({
  name: String(r.nombre ?? ''), salary: num(r.sueldo), payday: num(r.dia_cobro) || 1,
  varEstimate: num(r.estimado_variable), savingsGoal: num(r.ahorro_meta),
  marital: String(r.estado_civil ?? 'soltero'),
  readIds: Array.isArray(r.notif_leidas) ? (r.notif_leidas as string[]) : [],
  onboardingDone: Boolean(r.onboarding_ok),
})

/* ─── Cola de cambios pendientes ─────────────────────────────────────────── */

interface Op { t: string; op: 'up' | 'del'; id: string; row?: Row }

const claveCola = (u: string) => `saldo:cola:${u}`
const claveCache = (u: string) => `saldo:cache:${u}`

function leer<T>(clave: string): T | null {
  try { const s = localStorage.getItem(clave); return s ? (JSON.parse(s) as T) : null } catch { return null }
}
function escribir(clave: string, valor: unknown) {
  try { localStorage.setItem(clave, JSON.stringify(valor)) } catch { /* sin espacio: seguimos igual */ }
}

const esErrorDeRed = (e: { message?: string; code?: string } | null | undefined) => {
  const m = String(e?.message ?? '').toLowerCase()
  return !e?.code && (m.includes('fetch') || m.includes('network') || m.includes('load failed') || m === '')
}

/** Aplica la cola pendiente sobre datos traídos de la base (para no perder cambios que todavía no subieron) */
function aplicarPendientes(d: Datos, ops: Op[]): Datos {
  if (!ops.length) return d
  const out: Datos = { ...d }
  for (const op of ops) {
    if (op.t === PERFIL_TABLA) { if (op.row) out.perfil = perfilFromRow(op.row); continue }
    const key = (Object.keys(TABLAS) as ListaKey[]).find(k => TABLAS[k].tabla === op.t)
    if (!key) continue
    const lista = out[key] as { id: string }[]
    if (op.op === 'del') { (out[key] as unknown) = lista.filter(x => x.id !== op.id); continue }
    const item = (TABLAS[key].from as (r: Row) => { id: string })(op.row!)
    const i = lista.findIndex(x => x.id === op.id)
    ;(out[key] as unknown) = i >= 0 ? lista.map(x => (x.id === op.id ? item : x)) : [...lista, item]
  }
  return out
}

async function traerTabla(tabla: string): Promise<Row[]> {
  const filas: Row[] = []
  const paso = 1000
  for (let desde = 0; ; desde += paso) {
    const { data, error } = await supabase.from(tabla).select('*').order('created_at', { ascending: true }).range(desde, desde + paso - 1)
    if (error) throw error
    filas.push(...(data as Row[]))
    if (!data || data.length < paso) break
  }
  return filas
}

async function traerTodo(userId: string, nombreInicial: string): Promise<Datos> {
  const keys = Object.keys(TABLAS) as ListaKey[]
  const [perfilRes, ...listas] = await Promise.all([
    supabase.from(PERFIL_TABLA).select('*').eq('user_id', userId).maybeSingle(),
    ...keys.map(k => traerTabla(TABLAS[k].tabla)),
  ])
  if (perfilRes.error) throw perfilRes.error
  const d: Datos = { ...DATOS_VACIOS }
  d.perfil = perfilRes.data ? perfilFromRow(perfilRes.data as Row) : { ...PERFIL_VACIO, name: nombreInicial }
  keys.forEach((k, i) => { (d[k] as unknown) = listas[i].map(r => (TABLAS[k].from as (r: Row) => unknown)(r)) })
  return d
}

/* ─── Hook principal ─────────────────────────────────────────────────────── */

export type EstadoCarga = 'cargando' | 'listo' | 'error'

export function useNube(userId: string | null, nombreInicial = '') {
  const [datos, setDatosState] = useState<Datos>(DATOS_VACIOS)
  const [estado, setEstado] = useState<EstadoCarga>('cargando')
  const [pendientes, setPendientes] = useState(0)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const ref = useRef<Datos>(DATOS_VACIOS)
  const cola = useRef<Op[]>([])
  const subiendo = useRef<Promise<boolean> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const uidRef = useRef<string | null>(null)

  const guardarLocal = useCallback(() => {
    const u = uidRef.current
    if (!u) return
    escribir(claveCache(u), ref.current)
    escribir(claveCola(u), cola.current)
    setPendientes(cola.current.length)
  }, [])

  const setDatos = useCallback((d: Datos) => { ref.current = d; setDatosState(d) }, [])

  /** Sube la cola a la base. Devuelve true si quedó todo subido. */
  const subir = useCallback((): Promise<boolean> => {
    if (subiendo.current) return subiendo.current
    const tarea = (async () => {
      while (cola.current.length && uidRef.current) {
        const op = cola.current[0]
        const conflicto = op.t === PERFIL_TABLA ? 'user_id' : 'id'
        const { error } = op.op === 'up'
          ? await supabase.from(op.t).upsert(op.row!, { onConflict: conflicto })
          : await supabase.from(op.t).delete().eq(conflicto, op.id)
        if (error) {
          if (esErrorDeRed(error)) { setOnline(false); return false }
          console.error('No se pudo guardar un cambio, se descarta:', op, error)
        }
        // solo se saca si sigue siendo la misma operación (pudo reemplazarse mientras subía)
        if (cola.current[0] === op) cola.current = cola.current.slice(1)
        guardarLocal()
      }
      setOnline(true)
      return cola.current.length === 0
    })().finally(() => { subiendo.current = null })
    subiendo.current = tarea
    return tarea
  }, [guardarLocal])

  const programarSubida = useCallback((ms = 700) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void subir() }, ms)
  }, [subir])

  const encolar = useCallback((op: Op) => {
    const i = cola.current.findIndex(o => o.t === op.t && o.id === op.id && cola.current[0] !== o)
    if (i >= 0) cola.current = cola.current.map((o, j) => (j === i ? op : o))
    else cola.current = [...cola.current, op]
  }, [])

  /** Recarga desde la base (sube antes lo pendiente) */
  const recargar = useCallback(async () => {
    const u = uidRef.current
    if (!u) return
    await subir()
    try {
      const d = await traerTodo(u, nombreInicial)
      if (uidRef.current !== u) return
      setDatos(aplicarPendientes(d, cola.current))
      guardarLocal()
      setOnline(true)
      setEstado('listo')
    } catch (e) {
      console.warn('No se pudieron traer los datos', e)
      if (esErrorDeRed(e as { message?: string })) setOnline(false)
      setEstado(prev => (leer(claveCache(u)) ? 'listo' : prev === 'listo' ? 'listo' : 'error'))
    }
  }, [subir, setDatos, guardarLocal, nombreInicial])

  // Al cambiar de usuario: copia local al instante y después la base
  useEffect(() => {
    uidRef.current = userId
    if (!userId) { setDatos(DATOS_VACIOS); cola.current = []; setPendientes(0); setEstado('cargando'); return }
    const cache = leer<Datos>(claveCache(userId))
    cola.current = leer<Op[]>(claveCola(userId)) ?? []
    setPendientes(cola.current.length)
    if (cache) { setDatos({ ...DATOS_VACIOS, ...cache, perfil: { ...PERFIL_VACIO, ...cache.perfil } }); setEstado('listo') }
    else { setDatos({ ...DATOS_VACIOS, perfil: { ...PERFIL_VACIO, name: nombreInicial } }); setEstado('cargando') }
    void recargar()
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reintentos: al volver la conexión, al volver a la app y cada 30 s si hay pendientes
  useEffect(() => {
    if (!userId) return
    const alVolver = () => { setOnline(true); void recargar() }
    const alIrse = () => setOnline(false)
    const alMirar = () => { if (document.visibilityState === 'visible') void recargar() }
    window.addEventListener('online', alVolver)
    window.addEventListener('offline', alIrse)
    document.addEventListener('visibilitychange', alMirar)
    const iv = setInterval(() => { if (cola.current.length) void subir() }, 30000)
    return () => {
      window.removeEventListener('online', alVolver)
      window.removeEventListener('offline', alIrse)
      document.removeEventListener('visibilitychange', alMirar)
      clearInterval(iv)
    }
  }, [userId, recargar, subir])

  /** Cambia el perfil (sueldo, día de cobro, etc.) */
  const setPerfil = useCallback((cambio: Partial<Perfil> | ((p: Perfil) => Partial<Perfil>)) => {
    const u = uidRef.current
    if (!u) return
    const prev = ref.current.perfil
    const parcial = typeof cambio === 'function' ? cambio(prev) : cambio
    const perfil = { ...prev, ...parcial }
    setDatos({ ...ref.current, perfil })
    encolar({ t: PERFIL_TABLA, op: 'up', id: u, row: perfilToRow(perfil, u) })
    guardarLocal()
    programarSubida()
  }, [setDatos, encolar, guardarLocal, programarSubida])

  /** Cambia una lista (gastos, fijos, deudas…) y anota en la cola solo lo que cambió */
  const setLista = useCallback(<K extends ListaKey>(key: K, next: Datos[K] | ((prev: Datos[K]) => Datos[K])) => {
    if (!uidRef.current) return
    const prev = ref.current[key]
    const lista = typeof next === 'function' ? (next as (p: Datos[K]) => Datos[K])(prev) : next
    const def = TABLAS[key] as unknown as { tabla: string; to: (x: unknown) => Row }
    const antes = new Map((prev as { id: string }[]).map(x => [x.id, JSON.stringify(x)]))
    const ids = new Set<string>()
    for (const item of lista as { id: string }[]) {
      ids.add(item.id)
      if (antes.get(item.id) !== JSON.stringify(item)) encolar({ t: def.tabla, op: 'up', id: item.id, row: def.to(item) })
    }
    for (const id of antes.keys()) if (!ids.has(id)) encolar({ t: def.tabla, op: 'del', id })
    setDatos({ ...ref.current, [key]: lista })
    guardarLocal()
    programarSubida()
  }, [setDatos, encolar, guardarLocal, programarSubida])

  /** Antes de cerrar sesión: intenta subir todo. Devuelve true si no quedó nada pendiente. */
  const subirAntesDeSalir = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    return subir()
  }, [subir])

  return { datos, estado, pendientes, online, setPerfil, setLista, recargar, subirAntesDeSalir }
}

/** Borra la copia local de un usuario (al cerrar sesión o borrar la cuenta) */
export function borrarLocal(userId: string) {
  try { localStorage.removeItem(claveCache(userId)); localStorage.removeItem(claveCola(userId)) } catch { /* nada */ }
}
