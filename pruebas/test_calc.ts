import { parseMonto, getBudgetSnapshot, parseCSV, generateNotifications, daysUntilDue } from '../src/lib/calc'
let ok = 0, fail = 0
const check = (n: string, c: boolean, x?: unknown) => { if (c) { ok++; console.log('  ✅', n) } else { fail++; console.log('  ❌', n, x ?? '') } }

console.log('▶ Montos')
check('850.000 → 850000', parseMonto('850.000') === 850000)
check('1.234.567 → 1234567', parseMonto('1.234.567') === 1234567)
check('1.500,50 → 1500.5', parseMonto('1.500,50') === 1500.5)
check('$ 2.300 → 2300', parseMonto('$ 2.300') === 2300)
check('1500,5 → 1500.5', parseMonto('1500,5') === 1500.5)
check('12.5 → 12.5', parseMonto('12.5') === 12.5)
check('1,500.50 (formato EEUU) → 1500.5', parseMonto('1,500.50') === 1500.5)
check('-4350 → -4350', parseMonto('-4350') === -4350)
check('vacío → NaN', Number.isNaN(parseMonto('')))
check('letras → NaN', Number.isNaN(parseMonto('abc')))

console.log('▶ Presupuesto (estimado = lo gastable, sin doble descuento)')
const now = new Date(2026, 9, 15) // 15/10/2026, cobro el 5 → ciclo 05/10 a 05/11 (31 días, quedan 21)
const base = { salary: 1000000, payday: 5, savingsGoal: 100000, now,
  fixedExpenses: [{ id: 'f', name: 'Alquiler', amount: 300000, dueDay: 1, active: true }],
  debts: [{ id: 'd', name: 'Visa', balance: 200000, monthlyPayment: 50000 }] }
let b = getBudgetSnapshot({ ...base, expenses: [], varEstimate: 300000 })
check('Disponible = 1.000.000 − 300.000 − 50.000 − 100.000 = 550.000', b.disponible === 550000, b.disponible)
check('Presupuesto de variables = estimado (300.000)', b.totalBudget === 300000)
check('Libre = 250.000', b.libre === 250000)
check('Quedan 21 días', b.remainingDays === 21, b.remainingDays)
check('Diario = 300.000 / 21', Math.round(b.dailyBudget) === Math.round(300000 / 21))
b = getBudgetSnapshot({ ...base, varEstimate: 300000, expenses: [{ id: 'e', amount: 21000, concept: 'Super', category: 'comida', date: '2026-10-10' }] })
check('Un gasto anterior baja el diario una sola vez: (300.000 − 21.000)/21', Math.round(b.dailyBudget) === Math.round(279000 / 21), b.dailyBudget)
b = getBudgetSnapshot({ ...base, varEstimate: 0, expenses: [] })
check('Sin estimado usa todo el disponible', b.totalBudget === 550000)
b = getBudgetSnapshot({ ...base, varEstimate: 900000, expenses: [] })
check('Estimado mayor al disponible: tope y aviso', b.totalBudget === 550000 && b.estimadoExcedido)
b = getBudgetSnapshot({ ...base, varEstimate: 300000, expenses: [], incomes: [{ id: 'i', amount: 50000, concept: 'Changa', date: '2026-10-12' }] })
check('Ingreso extra suma al presupuesto (350.000)', b.totalBudget === 350000 && b.extraIncome === 50000)
b = getBudgetSnapshot({ ...base, varEstimate: 300000, expenses: [], incomes: [{ id: 'i', amount: 50000, concept: 'Viejo', date: '2026-09-12' }] })
check('Ingreso de otro ciclo no cuenta', b.totalBudget === 300000)
b = getBudgetSnapshot({ ...base, varEstimate: 300000, expenses: [], shared: [{ id: 's', amount: 10000, concept: 'Cena', category: 'ocio', date: '2026-10-15', sharedPersonId: 'p', myPercentage: 40, settled: false, paidBy: 'me' }] })
check('Compartido: cuenta solo mi parte (4.000) hoy', b.todaySpent === 4000)
b = getBudgetSnapshot({ ...base, varEstimate: 300000, expenses: [], fixedExpenses: [{ id: 'f', name: 'x', amount: 2000000, dueDay: 1, active: true }] })
check('Compromisos mayores al sueldo: disponible negativo', b.disponible < 0)

console.log('▶ Extractos')
const csv = 'Fecha;Descripción;Importe\n01/10/2026;SUPERMERCADO COTO;-4.350,00\n02/10/2026;HABERES;850.000,00\n03/10/2026;UBER;-1.800'
const t = parseCSV(csv, [{ date: '2026-10-01', amount: 4350, concept: 'Supermercado coto' }])
check('Lee 3 movimientos con ;', t.length === 3, t)
check('Montos con punto de miles bien (4350, 850000, 1800)', t[0].amount === 4350 && t[1].amount === 850000 && t[2].amount === 1800, t.map(x => x.amount))
check('Débito / crédito', t[0].isDebit && !t[1].isDebit)
check('Categoriza super como comida', t[0].category === 'comida')
check('Detecta duplicado', t[0].isDuplicate && !t[2].isDuplicate)
check('Fecha dd/mm/aaaa → aaaa-mm-dd', t[1].date === '2026-10-02')

console.log('▶ Notificaciones')
check('Vencimiento día 31 en mes de 30 días', daysUntilDue(31, new Date(2026, 10, 28)) === 2)
const n1 = generateNotifications({ ...base, varEstimate: 300000, expenses: [{ id: 'e', amount: 999999, concept: 'x', category: 'otros', date: '2026-10-15' }] })
const exc = n1.find(n => n.id.startsWith('budget-exceeded'))
check('Avisa presupuesto pasado, con id del día (vuelve a avisar otro día)', !!exc && exc.id.endsWith('2026-10-15'))
const n2 = generateNotifications({ ...base, varEstimate: 900000, expenses: [] })
check('Avisa estimado mayor al disponible', n2.some(n => n.id.startsWith('budget-estimate-high')))
check('Sin gastos no muestra resumen semanal vacío', !n2.some(n => n.type === 'weekly'))

console.log(`\nResultado: ${ok} bien, ${fail} mal`)
process.exit(fail ? 1 : 0)
