/* Cálculos y utilidades de Saldo (sin React, se pueden probar aparte) */

/* ─── Tipos ──────────────────────────────────────────────────────────────── */

export type Screen =
  | 'login' | 'onboarding' | 'home' | 'history'
  | 'fixed' | 'profile' | 'children'
  | 'shared' | 'reports' | 'import' | 'notifications'

export interface FixedExpense {
  id: string; name: string; amount: number; dueDay: number; active: boolean; lastPaidCycle?: string
}
export interface Debt {
  id: string; name: string; balance: number; monthlyPayment: number; lastPaidCycle?: string; lastPaymentAmount?: number
}
export interface Child {
  id: string; name: string; age: number; studies: boolean; schoolType: 'publica' | 'privada' | null
}
export interface Expense {
  id: string; amount: number; concept: string; category: string; date: string
}
export interface Income {
  id: string; amount: number; concept: string; date: string
}
export interface SharedPerson {
  id: string; name: string; color: string
}
export interface SharedExpense {
  id: string; amount: number; concept: string; category: string; date: string
  sharedPersonId: string; myPercentage: number; settled: boolean; paidBy: 'me' | 'them'
}
export interface ParsedTransaction {
  id: string; date: string; description: string; amount: number
  isDebit: boolean; category: string; selected: boolean; isDuplicate: boolean
}
export interface AppNotification {
  id: string
  type: 'due' | 'budget' | 'savings' | 'debt' | 'weekly' | 'tip'
  title: string
  body: string
  priority: 'high' | 'medium' | 'info'
  action?: { label: string; screen: Screen }
}
export interface Category {
  id: string; label: string; color: string
}

/** Datos de configuración del usuario (una fila por usuario en la base) */
export interface Perfil {
  name: string
  salary: number
  payday: number
  varEstimate: number
  savingsGoal: number
  marital: string
  readIds: string[]
  onboardingDone: boolean
}

export const PERFIL_VACIO: Perfil = {
  name: '', salary: 0, payday: 1, varEstimate: 0, savingsGoal: 0,
  marital: 'soltero', readIds: [], onboardingDone: false,
}

/* ─── Constantes ─────────────────────────────────────────────────────────── */

export const CATS: Category[] = [
  { id: 'comida',     label: 'Comida',     color: '#F97316' },
  { id: 'transporte', label: 'Transporte', color: '#3B82F6' },
  { id: 'salud',      label: 'Salud',      color: '#EF4444' },
  { id: 'ocio',       label: 'Ocio',       color: '#22C55E' },
  { id: 'vivienda',   label: 'Vivienda',   color: '#8B5CF6' },
  { id: 'educacion',  label: 'Educación',  color: '#6366F1' },
  { id: 'servicios',  label: 'Servicios',  color: '#EAB308' },
  { id: 'otros',      label: 'Otros',      color: '#6B7280' },
]

export const MARITAL = [
  { id: 'soltero',    label: 'Soltero/a'    },
  { id: 'pareja',     label: 'En pareja'    },
  { id: 'casado',     label: 'Casado/a'     },
  { id: 'divorciado', label: 'Divorciado/a' },
]

/* ─── Helpers ────────────────────────────────────────────────────────────── */

export const fmt = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

export const toDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export const todayStr = () => toDateKey(new Date())

export const dateStr = (daysAgo: number, now = new Date()) => {
  const d = new Date(now); d.setDate(d.getDate() - daysAgo); return toDateKey(d)
}

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

export const fmtDate = (iso: string) => {
  const [, m, d] = iso.split('-')
  return `${parseInt(d)} de ${MESES[parseInt(m) - 1]}`
}

export const shortDay = (iso: string) => {
  const days = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
  const d = new Date(iso + 'T12:00:00')
  return days[d.getDay()]
}

/** Identificador único (UUID v4), válido como clave en la base */
export const uid = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export const catInfo = (id: string, categories: Category[] = CATS) =>
  categories.find(c => c.id === id) ?? CATS[CATS.length - 1]

/**
 * Lee un monto escrito como lo escribe la gente en Argentina:
 * "850.000" → 850000 · "1.500,50" → 1500.5 · "$ 2.300" → 2300 · "1500,5" → 1500.5 · "12.5" → 12.5
 * Devuelve NaN si no es un número.
 */
export function parseMonto(raw: string | number | null | undefined): number {
  if (typeof raw === 'number') return raw
  let s = String(raw ?? '').trim().replace(/[$\s]/g, '').replace(/^ARS/i, '')
  if (!s) return NaN
  let neg = false
  if (s.startsWith('-')) { neg = true; s = s.slice(1) }
  else if (s.startsWith('(') && s.endsWith(')')) { neg = true; s = s.slice(1, -1) }
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma >= 0 && lastDot >= 0) {
    // los dos separadores: el último es el decimal
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (lastComma >= 0) {
    s = s.replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '') // "850.000" o "1.234.567" = miles
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN
  const n = parseFloat(s)
  return neg ? -n : n
}

/** Muestra un monto en un campo de texto con punto de miles ("1.200.000"; 0 → vacío) */
export const montoInput = (n: number) =>
  n ? new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2, useGrouping: true }).format(n) : ''

export const debtCommitment = (debts: Debt[], cycleKey?: string) =>
  debts.reduce((sum, debt) => {
    if (cycleKey && debt.lastPaidCycle === cycleKey) {
      return sum + (debt.lastPaymentAmount ?? debt.monthlyPayment)
    }
    return sum + Math.min(Math.max(debt.balance, 0), debt.monthlyPayment)
  }, 0)

export function getPayDate(year: number, month: number, payday: number) {
  const lastDay = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(Math.max(payday, 1), lastDay))
}

/** Gastos que cuentan para el presupuesto: los propios + mi parte de los compartidos */
export function spendingItems(expenses: Expense[], shared: SharedExpense[] = []) {
  return [
    ...expenses.map(e => ({ date: e.date, amount: e.amount, category: e.category })),
    ...shared.map(s => ({ date: s.date, amount: s.amount * (s.myPercentage / 100), category: s.category })),
  ]
}

/**
 * Presupuesto del ciclo (de cobro a cobro).
 *
 * - Disponible = sueldo + ingresos extra del ciclo − fijos − cuotas de deudas − meta de ahorro.
 * - El estimado de variables ES lo que se puede gastar en el día a día (más los ingresos extra),
 *   con tope en el disponible. Si no se cargó estimado, se usa todo el disponible.
 * - Lo que sobra entre el disponible y el presupuesto de variables queda "Libre" (sin asignar).
 * - Cada gasto cargado (y mi parte de los compartidos) se descuenta del presupuesto de variables.
 */
export function getBudgetSnapshot(args: {
  salary: number
  fixedExpenses: FixedExpense[]
  debts: Debt[]
  expenses: Expense[]
  incomes?: Income[]
  shared?: SharedExpense[]
  varEstimate: number
  savingsGoal: number
  payday: number
  now?: Date
}) {
  const { salary, fixedExpenses, debts, expenses, incomes = [], shared = [], varEstimate, savingsGoal, payday } = args
  const now = args.now ?? new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const thisMonthPayday = getPayDate(today.getFullYear(), today.getMonth(), payday)
  const cycleStart = today >= thisMonthPayday
    ? thisMonthPayday
    : getPayDate(today.getFullYear(), today.getMonth() - 1, payday)
  const cycleEnd = today >= thisMonthPayday
    ? getPayDate(today.getFullYear(), today.getMonth() + 1, payday)
    : thisMonthPayday
  const dayMs = 24 * 60 * 60 * 1000
  const totalDays = Math.max(1, Math.round((cycleEnd.getTime() - cycleStart.getTime()) / dayMs))
  const remainingDays = Math.max(1, Math.round((cycleEnd.getTime() - today.getTime()) / dayMs))
  const elapsedDays = Math.max(1, totalDays - remainingDays + 1)
  const startKey = toDateKey(cycleStart)
  const endKey = toDateKey(cycleEnd)
  const todayKey = toDateKey(today)
  const inCycle = (d: string) => d >= startKey && d < endKey

  const cycleExpenses = expenses.filter(e => inCycle(e.date))
  const items = spendingItems(expenses, shared).filter(i => inCycle(i.date))
  const todaySpent = items.filter(i => i.date === todayKey).reduce((s, i) => s + i.amount, 0)
  const spentBeforeToday = items.filter(i => i.date < todayKey).reduce((s, i) => s + i.amount, 0)
  const cycleSpent = spentBeforeToday + todaySpent

  const extraIncome = incomes.filter(i => inCycle(i.date)).reduce((s, i) => s + i.amount, 0)
  const totalFixed = fixedExpenses.filter(e => e.active).reduce((s, e) => s + e.amount, 0)
  const totalDebt = debtCommitment(debts, startKey)
  const committed = totalFixed + totalDebt + savingsGoal
  const disponible = salary + extraIncome - committed
  const varBudget = varEstimate > 0 ? Math.min(varEstimate + extraIncome, disponible) : disponible
  const libre = disponible - varBudget
  const totalBudget = varBudget
  const dailyBudget = (totalBudget - spentBeforeToday) / remainingDays

  return {
    cycleStart, cycleEnd, startKey, endKey, totalDays, remainingDays, elapsedDays,
    cycleExpenses, cycleSpent, todaySpent, spentBeforeToday,
    extraIncome, totalFixed, totalDebt, committed, disponible, libre,
    totalBudget, dailyBudget,
    /** el estimado de variables supera lo que queda después de los compromisos */
    estimadoExcedido: varEstimate > 0 && disponible > 0 && varEstimate + extraIncome > disponible,
    availableToday: dailyBudget - todaySpent,
  }
}

/* ─── Importación de extractos ───────────────────────────────────────────── */

const CAT_RULES: [string, string[]][] = [
  ['comida',     ['supermercado','coto','dia ','carrefour','walmart','jumbo','almacen','panaderia','pizzeria','restaurant','cafe','mcdonald','burger','subway','rappi','pedidos','kiosco','vivanda','disco','vea','changomas','burger king']],
  ['transporte', ['sube','colectivo','subte','taxi','uber','remis','peaje','ypf','shell','axion','petrobras','nafta','combustible','repsol','cabify','trenes','aerol','latam','flybondi','bus ']],
  ['salud',      ['farmacia','clinica','hospital','medico','doctor','laboratorio','odontologia','dentista','sanatorio','obra social','mutual','pami','salud ']],
  ['ocio',       ['netflix','spotify','steam','amazon prime','hbo','disney','apple tv','boliche','cine','teatro','casino','loteria','entretenimiento']],
  ['vivienda',   ['alquiler','expensas','inmobiliaria','home depot','easy','sodimac','pintur','muebles','construcc','ferreteria']],
  ['educacion',  ['universidad','facultad','colegio','libreria','udemy','coursera','cambridge','english','idioma','escuela','capacitac']],
  ['servicios',  ['personal cel','claro','movistar','telecom','fibertel','telecentro','cablevision','edesur','edenor','metrogas','aguas','aysa','telefon','internet','wifi','luz ','electric','gas ban']],
]

export function guessCategory(desc: string): string {
  const d = desc.toLowerCase()
  for (const [cat, kws] of CAT_RULES) {
    if (kws.some(kw => d.includes(kw))) return cat
  }
  return 'otros'
}

export function parseISODate(raw: string): string {
  const s = raw.trim()
  if (/^\d{8}/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`
  const dmy2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)
  if (dmy2) return `20${dmy2[3]}-${dmy2[2].padStart(2,'0')}-${dmy2[1].padStart(2,'0')}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return todayStr()
}

export function parseDelimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++ }
      else quoted = !quoted
    } else if (char === delimiter && !quoted) {
      row.push(field.trim()); field = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field.trim())
      if (row.some(value => value !== '')) rows.push(row)
      row = []; field = ''
    } else {
      field += char
    }
  }
  row.push(field.trim())
  if (row.some(value => value !== '')) rows.push(row)
  return rows
}

type Movimiento = { date: string; amount: number; concept: string }

export function isPotentialDuplicate(existing: Movimiento[], date: string, amount: number, description: string) {
  const normalize = (value: string) => value
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const incoming = normalize(description)
  return existing.some(e => {
    if (e.date !== date || Math.abs(e.amount - amount) > Math.max(1, amount * 0.001)) return false
    const saved = normalize(e.concept)
    return !incoming || !saved || incoming.includes(saved) || saved.includes(incoming)
  })
}

function makeTxn(existing: Movimiento[], date: string, description: string, amount: number, isDebit: boolean): ParsedTransaction {
  return {
    id: uid(), date, description, amount, isDebit, category: guessCategory(description),
    selected: isDebit, isDuplicate: isPotentialDuplicate(existing, date, amount, description),
  }
}

export function parseCSV(text: string, existing: Movimiento[]): ParsedTransaction[] {
  const clean = text.replace(/^﻿/, '')
  const firstLine = clean.split(/\r?\n/, 1)[0]
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows = parseDelimitedRows(clean, delim)
  if (rows.length < 2) return []
  const header = rows[0].map(value => value.toLowerCase().trim())
  const colIdx = (keys: string[]) => {
    for (const k of keys) { const i = header.findIndex(h => h.includes(k)); if (i >= 0) return i }
    return -1
  }
  const dateCol = colIdx(['fecha','date','fec'])
  const descCol = colIdx(['descripcion','descripción','concepto','detalle','memo','description','movimiento'])
  const debitCol = colIdx(['debito','débito','debit'])
  const creditCol = colIdx(['credito','crédito','credit'])
  const amtCol = header.findIndex(value =>
    ['monto', 'importe', 'amount', 'valor'].some(key => value.includes(key))
    && !['debito', 'débito', 'debit', 'credito', 'crédito', 'credit'].some(key => value.includes(key))
  )
  const typeCol = colIdx(['tipo','type','clase'])
  const out: ParsedTransaction[] = []

  if (dateCol < 0 || (amtCol < 0 && debitCol < 0 && creditCol < 0)) {
    // sin encabezados reconocibles: fecha, descripción, monto
    for (const cols of rows.slice(1)) {
      if (cols.length < 3) continue
      const raw = parseMonto(cols[2])
      if (!Number.isFinite(raw) || raw === 0) continue
      out.push(makeTxn(existing, parseISODate(cols[0]), cols[1] || 'Transacción', Math.abs(raw), raw < 0))
    }
    return out
  }

  for (const cols of rows.slice(1)) {
    let raw = amtCol >= 0 ? parseMonto(cols[amtCol] ?? '') : NaN
    let columnDebit: boolean | null = null
    if (amtCol < 0) {
      const debitValue = debitCol >= 0 ? parseMonto(cols[debitCol] ?? '') : NaN
      const creditValue = creditCol >= 0 ? parseMonto(cols[creditCol] ?? '') : NaN
      if (Number.isFinite(debitValue) && debitValue !== 0) { raw = debitValue; columnDebit = true }
      else if (Number.isFinite(creditValue) && creditValue !== 0) { raw = creditValue; columnDebit = false }
    }
    if (!Number.isFinite(raw) || raw === 0) continue
    const typeHint = typeCol >= 0 ? (cols[typeCol] ?? '').toLowerCase() : ''
    const isDebit = columnDebit ?? (typeHint ? typeHint.includes('deb') || typeHint.includes('gasto') : raw < 0)
    const description = (descCol >= 0 ? cols[descCol] : '') || 'Transacción'
    out.push(makeTxn(existing, parseISODate(cols[dateCol] ?? ''), description, Math.abs(raw), isDebit))
  }
  return out
}

export function parseOFX(text: string, existing: Movimiento[]): ParsedTransaction[] {
  const txnPattern = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi
  const get = (block: string, tag: string) => {
    const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i'))
    return m ? m[1].trim() : ''
  }
  const results: ParsedTransaction[] = []
  let m: RegExpExecArray | null
  while ((m = txnPattern.exec(text)) !== null) {
    const block = m[1]
    const raw = parseMonto(get(block, 'TRNAMT') || '0')
    if (!Number.isFinite(raw) || raw === 0) continue
    const description = get(block, 'MEMO') || get(block, 'NAME') || 'Transacción'
    results.push(makeTxn(existing, parseISODate(get(block, 'DTPOSTED')), description, Math.abs(raw), raw < 0))
  }
  return results
}

/* ─── Notificaciones ─────────────────────────────────────────────────────── */

export function daysUntilDue(dueDay: number, now = new Date()): number {
  const day = now.getDate()
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const dueThisMonth = Math.min(dueDay, dim)
  if (dueThisMonth >= day) return dueThisMonth - day
  const dimNext = new Date(now.getFullYear(), now.getMonth() + 2, 0).getDate()
  return (dim - day) + Math.min(dueDay, dimNext)
}

/** Lunes de la semana de una fecha, para que el resumen semanal vuelva a aparecer cada semana */
function weekKey(now: Date) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return toDateKey(d)
}

export function generateNotifications(args: {
  fixedExpenses: FixedExpense[]; debts: Debt[]; expenses: Expense[]; incomes?: Income[]; shared?: SharedExpense[]
  salary: number; varEstimate: number; savingsGoal: number; payday: number; now?: Date
}): AppNotification[] {
  const { fixedExpenses, debts, expenses } = args
  const now = args.now ?? new Date()
  const out: AppNotification[] = []
  const budget = getBudgetSnapshot({ ...args, now })
  const { dailyBudget, todaySpent, cycleSpent, totalBudget, totalDays, elapsedDays, startKey } = budget
  const todayKey = toDateKey(now)
  const last7dates = Array.from({ length: 7 }, (_, i) => dateStr(i, now))
  const weekSpent = spendingItems(expenses, args.shared).filter(e => last7dates.includes(e.date)).reduce((s, e) => s + e.amount, 0)

  for (const fe of fixedExpenses.filter(f => f.active && f.lastPaidCycle !== startKey)) {
    const d = daysUntilDue(fe.dueDay, now)
    if (d <= 10) {
      const label = d === 0 ? 'vence hoy' : d === 1 ? 'vence mañana' : `vence en ${d} días`
      out.push({ id: `due-${fe.id}-${startKey}-${d <= 1 ? 'urg' : 'prox'}`, type: 'due',
        title: `${fe.name} ${label}`,
        body: `Acordate de tener ${fmt(fe.amount)} disponibles para el día ${fe.dueDay}.`,
        priority: d <= 1 ? 'high' : d <= 4 ? 'medium' : 'info',
        action: { label: 'Ver fijos', screen: 'fixed' } })
    }
  }

  if (budget.disponible <= 0) {
    out.push({
      id: `budget-structural-deficit-${startKey}`, type: 'budget',
      title: 'Tus compromisos superan tus ingresos',
      body: `Fijos, deudas y ahorro exceden lo que cobrás por ${fmt(Math.abs(budget.disponible))}. Revisá tu configuración para recuperar margen.`,
      priority: 'high', action: { label: 'Revisar fijos', screen: 'fixed' },
    })
  } else if (budget.estimadoExcedido) {
    out.push({
      id: `budget-estimate-high-${startKey}`, type: 'budget',
      title: 'Tu estimado de variables es más de lo que te queda',
      body: `Después de fijos, deudas y ahorro te quedan ${fmt(budget.disponible)}. Usamos ese monto como presupuesto; podés bajar el estimado en tu perfil.`,
      priority: 'medium', action: { label: 'Ir al perfil', screen: 'profile' },
    })
  }

  const dailyRatio = dailyBudget > 0 ? todaySpent / dailyBudget : (todaySpent > 0 ? 1 : 0)
  if (dailyRatio >= 1) {
    out.push({ id: `budget-exceeded-${todayKey}`, type: 'budget',
      title: 'Pasaste el presupuesto de hoy',
      body: `Gastaste ${fmt(todaySpent - Math.max(0, dailyBudget))} más de lo planeado. La diferencia se reparte entre los días que quedan.`,
      priority: 'high' })
  } else if (dailyRatio >= 0.8) {
    out.push({ id: `budget-warning-${todayKey}`, type: 'budget',
      title: 'Casi sin presupuesto diario',
      body: `Usaste el ${Math.round(dailyRatio * 100)}% del presupuesto de hoy. Solo te quedan ${fmt(dailyBudget - todaySpent)}.`,
      priority: 'medium' })
  }

  const expectedByNow = (totalBudget / totalDays) * elapsedDays
  if (totalBudget > 0 && cycleSpent > expectedByNow * 1.2 && elapsedDays > 5) {
    const projected = (cycleSpent / elapsedDays) * totalDays
    out.push({ id: `savings-risk-${startKey}`, type: 'savings',
      title: 'Meta de ahorro en riesgo',
      body: `Al ritmo actual llegás al próximo cobro con ${fmt(projected)} gastados, ${fmt(projected - totalBudget)} por encima del presupuesto.`,
      priority: 'high', action: { label: 'Ver reportes', screen: 'reports' } })
  } else if (totalBudget > 0 && cycleSpent < expectedByNow * 0.75 && elapsedDays > 10) {
    out.push({ id: `savings-ok-${startKey}`, type: 'savings',
      title: 'Vas muy bien con el ahorro',
      body: `Gastaste ${fmt(expectedByNow - cycleSpent)} menos de lo esperado para este punto del ciclo.`,
      priority: 'info', action: { label: 'Ver reportes', screen: 'reports' } })
  }

  for (const d of debts) {
    if (d.balance <= 0) {
      out.push({ id: `debt-paid-${d.id}`, type: 'debt',
        title: `${d.name} saldada`,
        body: 'Terminaste de pagar esta deuda. Ese margen quedará disponible en tu próximo ciclo.',
        priority: 'info', action: { label: 'Ver deudas', screen: 'fixed' } })
      continue
    }
    const months = Math.ceil(d.balance / d.monthlyPayment)
    if (months <= 4) {
      out.push({ id: `debt-close-${d.id}-${months}`, type: 'debt',
        title: `${d.name}: últimas cuotas`,
        body: `Te quedan solo ${months} ${months === 1 ? 'pago' : 'pagos'} de ${fmt(d.monthlyPayment)} para saldarla.`,
        priority: 'info', action: { label: 'Ver deudas', screen: 'fixed' } })
    }
  }

  if (weekSpent > 0) {
    const weekBudget = Math.max(0, dailyBudget * 7)
    const weekPct = weekBudget > 0 ? Math.round((weekSpent / weekBudget) * 100) : 0
    out.push({ id: `weekly-summary-${weekKey(now)}`, type: 'weekly',
      title: 'Resumen semanal',
      body: weekBudget > 0
        ? `Gastaste ${fmt(weekSpent)} en los últimos 7 días: ${weekPct}% del presupuesto de 7 días (${fmt(weekBudget)}).`
        : `Gastaste ${fmt(weekSpent)} en los últimos 7 días.`,
      priority: 'info', action: { label: 'Ver reportes', screen: 'reports' } })
  }

  const last30 = Array.from({ length: 30 }, (_, i) => dateStr(i, now))
  const byKey: Record<string, number[]> = {}
  expenses.filter(e => last30.includes(e.date) && e.concept.trim()).forEach(e => {
    const k = e.concept.toLowerCase().trim().slice(0, 14)
    if (!byKey[k]) byKey[k] = []
    byKey[k].push(e.amount)
  })
  const fixedNames = fixedExpenses.map(f => f.name.toLowerCase())
  const topRecurring = Object.entries(byKey)
    .filter(([k, v]) => v.length >= 3 && !fixedNames.some(n => k.includes(n.slice(0, 6))))
    .sort((a, b) => b[1].length - a[1].length)[0]
  if (topRecurring) {
    const [k, amounts] = topRecurring
    const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length
    out.push({ id: `recurring-${k}-${startKey}`, type: 'tip',
      title: 'Gasto frecuente detectado',
      body: `"${k}" aparece ${amounts.length} veces en los últimos 30 días (~${fmt(avg)} c/u). ¿Lo agregás como fijo?`,
      priority: 'info', action: { label: 'Agregar fijo', screen: 'fixed' } })
  }

  return out
}
