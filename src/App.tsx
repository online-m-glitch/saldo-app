import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { BarChart, Bar, XAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts'
import type { Session } from '@supabase/supabase-js'
import {
  CATS, MARITAL, PERFIL_VACIO, fmt, todayStr, dateStr, fmtDate, shortDay, uid, catInfo, parseMonto, montoInput,
  debtCommitment, getBudgetSnapshot, parseCSV, parseOFX, generateNotifications,
  type Screen, type FixedExpense, type Debt, type Child, type Expense, type Income, type SharedPerson,
  type SharedExpense, type ParsedTransaction, type AppNotification, type Category, type Perfil,
} from './lib/calc'
import { supabase, redirectUrl, errorAuth } from './lib/supabase'
import { useNube, borrarLocal } from './lib/store'

/* ─── Categorías (base + propias del usuario) ────────────────────────────── */

const CategoryContext = createContext<{
  categories: Category[]
  addCategory: (category: Category) => void
}>({ categories: CATS, addCategory: () => undefined })

const useCategories = () => useContext(CategoryContext)

/** Guarda en el dispositivo una preferencia local (por ejemplo, el modo oscuro) */
function usePersistentState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored === null ? initialValue : (JSON.parse(stored) as T)
    } catch {
      return initialValue
    }
  })
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* sin espacio */ }
  }, [key, value])
  return [value, setValue] as const
}

/** Color de texto sobre el ámbar de la marca (siempre oscuro, en claro y en oscuro) */
const ON_ACCENT = '#2B2F36'

/* ─── UI primitives ──────────────────────────────────────────────────────── */

function Btn({ children, onClick, variant = 'primary', className = '', disabled = false, type = 'button' }: {
  children: React.ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger'; className?: string
  disabled?: boolean; type?: 'button' | 'submit'
}) {
  const base = 'w-full py-4 rounded-2xl font-semibold text-base transition-all duration-150 active:scale-[0.97] select-none disabled:opacity-50 disabled:pointer-events-none '
  const s = {
    // texto oscuro fijo sobre el ámbar: se lee bien también en modo oscuro
    primary: 'bg-[#E8A33D] text-[#2B2F36] hover:brightness-95 shadow-sm hover:shadow-md',
    ghost:   'bg-transparent text-[var(--fg)] border border-[var(--border)] hover:bg-[var(--subtle)]',
    danger:  'bg-red-500/10 text-red-500 hover:bg-red-500/20',
  }
  return <button type={type} disabled={disabled} className={base + s[variant] + ' ' + className} onClick={onClick}>{children}</button>
}

/**
 * Campo de texto. type="money" acepta montos escritos con punto de miles ("850.000") o coma decimal;
 * type="int" es para días, edades y porcentajes. Los dos abren el teclado numérico en el celular.
 */
function Input({ label, value, onChange, type = 'text', placeholder = '', autoFocus = false, error, autoComplete, name }: {
  label?: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; autoFocus?: boolean; error?: string
  autoComplete?: string; name?: string
}) {
  const htmlType = type === 'money' || type === 'int' || type === 'number' ? 'text' : type
  const inputMode = type === 'money' ? 'decimal' : type === 'int' || type === 'number' ? 'numeric' : undefined
  const id = `campo-${(name ?? label ?? 'x').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
          {label}
        </label>
      )}
      <input
        id={id}
        name={name}
        type={htmlType}
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className="w-full rounded-xl px-4 py-3.5 text-base outline-none transition-all duration-200"
        style={{
          background: 'var(--input-bg)',
          color: 'var(--fg)',
          border: `1.5px solid ${error ? '#EF4444' : 'var(--border)'}`,
        }}
        onFocus={e => { e.currentTarget.style.borderColor = '#E8A33D'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(232,163,61,0.15)' }}
        onBlur={e => { e.currentTarget.style.borderColor = error ? '#EF4444' : 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
      />
      {error && <p id={`${id}-error`} className="text-xs text-red-500" role="alert">{error}</p>}
    </div>
  )
}

function Toggle({ value, onChange, label = 'Cambiar opción' }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button onClick={() => onChange(!value)} role="switch" aria-checked={value} aria-label={label}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${value ? 'bg-[#E8A33D]' : 'bg-[var(--border)]'}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow-sm transition-transform duration-200 ${value ? 'translate-x-5' : ''}`}
        style={{ background: 'var(--card)' }} />
    </button>
  )
}

function PageHeader({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-5 py-4 flex-shrink-0">
      {onBack && (
        <button onClick={onBack} aria-label="Volver"
          className="w-9 h-9 flex items-center justify-center rounded-full transition-all duration-150 active:scale-[0.93] -ml-1.5"
          style={{ color: 'var(--fg)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--subtle)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12.5 4.5L7 10L12.5 15.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}
      <span className="flex-1 text-[17px] font-bold" style={{ color: 'var(--fg)' }}>{title}</span>
      {right}
    </div>
  )
}

function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="flex rounded-2xl p-1 mx-5 mb-4 flex-shrink-0" style={{ background: 'var(--card)' }}>
      {tabs.map(t => (
        <button key={t} onClick={() => onChange(t)}
          className="flex-1 py-2 rounded-xl text-sm font-semibold transition-all duration-150 active:scale-[0.97]"
          style={{
            background: active === t ? 'var(--fg)' : 'transparent',
            color: active === t ? 'var(--bg)' : 'var(--muted)',
          }}>
          {t}
        </button>
      ))}
    </div>
  )
}

function ConfirmDialog({ title, body, confirmLabel, onConfirm, onClose }: {
  title: string; body: string; confirmLabel: string; onConfirm: () => void; onClose: () => void
}) {
  return (
    <>
      <div className="absolute inset-0 bg-black/50 z-40 fade-in" onClick={onClose} />
      <div className="absolute inset-0 z-50 flex items-center justify-center px-6 pointer-events-none">
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-body"
          className="w-full max-w-sm rounded-3xl p-5 pointer-events-auto screen-enter"
          style={{ background: 'var(--card)', boxShadow: 'var(--shadow-md)' }}
        >
          <h2 id="confirm-title" className="text-xl font-bold" style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--fg)' }}>{title}</h2>
          <p id="confirm-body" className="text-sm leading-relaxed mt-2 mb-5" style={{ color: 'var(--muted)' }}>{body}</p>
          <div className="flex gap-3">
            <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn variant="danger" onClick={onConfirm}>{confirmLabel}</Btn>
          </div>
        </div>
      </div>
    </>
  )
}

/* ─── Icons ──────────────────────────────────────────────────────────────── */

const IconUser = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M3 17C3 14 6 12 10 12C14 12 17 14 17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IconChildren = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <circle cx="7" cy="6.5" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
    <circle cx="13" cy="6.5" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M2 16C2 13.5 4.5 12 7 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M18 16C18 13.5 15.5 12 13 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IconList = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M7 5H17M7 10H17M7 15H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="4" cy="5" r="1" fill="currentColor"/>
    <circle cx="4" cy="10" r="1" fill="currentColor"/>
    <circle cx="4" cy="15" r="1" fill="currentColor"/>
  </svg>
)
const IconHistory = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M10 6V10.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const IconShared = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <circle cx="6.5" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/>
    <circle cx="13.5" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M1 17C1 14.5 3.5 13 6.5 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M19 17C19 14.5 16.5 13 13.5 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M9 15.5C9 14 10.5 13 12 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IconReports = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M3 15L7 9L10.5 12L14 6.5L17 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M3 18H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IconBell = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M10 2C7 2 5 4.5 5 7.5V12L3 14H17L15 12V7.5C15 4.5 13 2 10 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    <path d="M8 14C8 15.1 8.9 16 10 16C11.1 16 12 15.1 12 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IconImport = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M10 3V13M10 13L6.5 9.5M10 13L13.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M3 15H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IconLogout = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M13 7L16.5 10L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M7 10H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M10 3H5C4 3 3 4 3 5V15C3 16 4 17 5 17H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IconClose = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M1 1L11 11M1 11L11 1" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
  </svg>
)
const IconX = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M1 1L9 9M1 9L9 1" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
  </svg>
)
const IconEdit = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <path d="M2 9.5L1.5 11.5L3.5 11L10.7 3.8C11.1 3.4 11.1 2.8 10.7 2.4L10.6 2.3C10.2 1.9 9.6 1.9 9.2 2.3L2 9.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M8.4 3.1L9.9 4.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
)
const IconSun = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <circle cx="9" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M9 1.5V3M9 15V16.5M16.5 9H15M3 9H1.5M14.3 3.7L13.2 4.8M4.8 13.2L3.7 14.3M14.3 14.3L13.2 13.2M4.8 4.8L3.7 3.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IconMoon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M15.5 10.5C14.5 13.5 11.7 15.5 8.5 15.5C4.6 15.5 1.5 12.4 1.5 8.5C1.5 5.3 3.5 2.5 6.5 1.5C5 4.5 5.5 8 7.7 10.3C10 12.5 13.5 13 15.5 10.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
  </svg>
)

/* ─── Login screen ───────────────────────────────────────────────────────── */

const LogoSaldo = ({ size = 48 }: { size?: number }) => (
  <div className="rounded-[14px] bg-[#E8A33D] flex items-center justify-center" style={{ width: size, height: size }}>
    <svg width={size * 0.54} height={size * 0.54} viewBox="0 0 26 26" fill="none">
      <path d="M13 3C13 3 8.5 6 8.5 11C8.5 13.8 10.2 16 13 16.5C15.8 16 17.5 13.8 17.5 11C17.5 6 13 3 13 3Z" fill={ON_ACCENT}/>
      <path d="M10 21H16M13 16.5V22" stroke={ON_ACCENT} strokeWidth="1.75" strokeLinecap="round"/>
    </svg>
  </div>
)

type AuthModo = 'login' | 'registro' | 'olvide'

function LoginScreen({ modo, setModo, avisoInicial = '' }: { modo: AuthModo; setModo: (m: AuthModo) => void; avisoInicial?: string }) {
  const [email, setEmail] = useState('')
  const [pass,  setPass]  = useState('')
  const [name,  setName]  = useState('')
  const [errors, setErrors] = useState<{ name?: string; email?: string; pass?: string }>({})
  const [general, setGeneral] = useState(avisoInicial)
  const [aviso, setAviso] = useState('')
  const [cargando, setCargando] = useState(false)
  const isRegister = modo === 'registro'
  const olvide = modo === 'olvide'

  const cambiarModo = (m: AuthModo) => { setModo(m); setErrors({}); setGeneral(''); setAviso('') }

  const submit = async () => {
    const nextErrors: typeof errors = {}
    if (isRegister && !name.trim()) nextErrors.name = 'Ingresá tu nombre.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) nextErrors.email = 'Ingresá un email válido.'
    if (!olvide) {
      if (isRegister && (pass.length < 8 || !/[a-zA-Z]/.test(pass) || !/\d/.test(pass))) nextErrors.pass = 'Usá al menos 8 caracteres, con letras y números.'
      else if (!isRegister && pass.length < 6) nextErrors.pass = 'Ingresá tu contraseña.'
    }
    setErrors(nextErrors); setGeneral(''); setAviso('')
    if (Object.keys(nextErrors).length) return
    setCargando(true)
    try {
      if (olvide) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectUrl() })
        if (error) throw error
        setAviso('Si hay una cuenta con ese email, te mandamos un link para crear una contraseña nueva. Revisá tu casilla (y el correo no deseado).')
      } else if (isRegister) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(), password: pass,
          options: { data: { nombre: name.trim() }, emailRedirectTo: redirectUrl() },
        })
        if (error) throw error
        // Supabase no avisa si el email ya existía: en ese caso no devuelve identidades
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          setGeneral('Ya existe una cuenta con ese email. Probá ingresar o recuperar la contraseña.')
        } else if (!data.session) {
          setAviso(`Te mandamos un mail a ${email.trim()} para confirmar la cuenta. Abrí el link y vas a entrar directo a la app.`)
        }
        // con sesión, la app pasa sola a la configuración inicial
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass })
        if (error) throw error
      }
    } catch (e) {
      setGeneral(errorAuth(e))
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col px-6 pt-16 pb-8 overflow-y-auto screen-enter">
      <div className="mb-10">
        <div className="mb-6 transition-transform hover:scale-105 w-fit"><LogoSaldo /></div>
        <p className="text-xs font-semibold text-[#E8A33D] uppercase tracking-widest mb-2">Saldo</p>
        <h1 className="text-[34px] font-bold leading-tight whitespace-pre-line" style={{ fontFamily: '"DM Serif Display", serif', fontStyle: 'italic', color: 'var(--fg)' }}>
          {isRegister ? 'Crear cuenta.' : olvide ? 'Recuperar\ncontraseña.' : 'Bienvenido\nde vuelta.'}
        </h1>
        <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
          {isRegister ? 'Tomá el control de tu plata.' : olvide ? 'Te mandamos un link a tu email.' : 'Tu plata, clara.'}
        </p>
      </div>
      <form className="flex flex-col gap-4 flex-1" onSubmit={e => { e.preventDefault(); void submit() }} noValidate>
        {isRegister && <Input label="Tu nombre" name="nombre" autoComplete="given-name" value={name} onChange={v => { setName(v); setErrors(p => ({ ...p, name: undefined })) }} placeholder="Martín" error={errors.name} />}
        <Input label="Email" name="email" autoComplete="email" value={email} onChange={v => { setEmail(v); setErrors(p => ({ ...p, email: undefined })) }} type="email" placeholder="tu@email.com" error={errors.email} />
        {!olvide && (
          <Input label="Contraseña" name="password" autoComplete={isRegister ? 'new-password' : 'current-password'} value={pass}
            onChange={v => { setPass(v); setErrors(p => ({ ...p, pass: undefined })) }} type="password" placeholder="••••••••" error={errors.pass} />
        )}
        {!isRegister && !olvide && (
          <button type="button" onClick={() => cambiarModo('olvide')} className="text-xs font-semibold text-right -mt-2 transition-opacity hover:opacity-75" style={{ color: 'var(--muted)' }}>
            ¿Olvidaste tu contraseña?
          </button>
        )}
        {general && <p className="text-sm text-red-500 text-center" role="alert">{general}</p>}
        {aviso && (
          <div className="rounded-2xl p-4 bg-[#E8A33D]/10" role="status">
            <p className="text-sm leading-relaxed" style={{ color: 'var(--fg)' }}>{aviso}</p>
          </div>
        )}
        <div className="mt-2">
          <Btn type="submit" disabled={cargando}>
            {cargando ? 'Un momento…' : isRegister ? 'Crear cuenta' : olvide ? 'Enviar link' : 'Ingresar'}
          </Btn>
        </div>
        <p className="text-center text-sm">
          {olvide ? (
            <button type="button" onClick={() => cambiarModo('login')} className="text-[#E8A33D] font-semibold transition-opacity hover:opacity-75">Volver a ingresar</button>
          ) : (
            <>
              <span style={{ color: 'var(--muted)' }}>{isRegister ? '¿Ya tenés cuenta? ' : '¿No tenés cuenta? '}</span>
              <button type="button" onClick={() => cambiarModo(isRegister ? 'login' : 'registro')} className="text-[#E8A33D] font-semibold transition-opacity hover:opacity-75 active:scale-[0.97]">
                {isRegister ? 'Iniciá sesión' : 'Registrate'}
              </button>
            </>
          )}
        </p>
      </form>
    </div>
  )
}

/* ─── Nueva contraseña (al volver del link del mail) ─────────────────────── */

function NewPasswordScreen({ onDone }: { onDone: () => void }) {
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const guardar = async () => {
    if (pass.length < 8 || !/[a-zA-Z]/.test(pass) || !/\d/.test(pass)) { setError('Usá al menos 8 caracteres, con letras y números.'); return }
    if (pass !== pass2) { setError('Las contraseñas no coinciden.'); return }
    setCargando(true); setError('')
    const { error: e } = await supabase.auth.updateUser({ password: pass })
    setCargando(false)
    if (e) { setError(errorAuth(e)); return }
    onDone()
  }
  return (
    <div className="flex-1 flex flex-col px-6 pt-16 pb-8 overflow-y-auto screen-enter">
      <div className="mb-8">
        <div className="mb-6 w-fit"><LogoSaldo /></div>
        <h1 className="text-[32px] font-bold leading-tight" style={{ fontFamily: '"DM Serif Display", serif', fontStyle: 'italic', color: 'var(--fg)' }}>Contraseña nueva.</h1>
        <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>Elegí una contraseña para tu cuenta.</p>
      </div>
      <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); void guardar() }} noValidate>
        <Input label="Contraseña nueva" name="password" autoComplete="new-password" type="password" value={pass} onChange={v => { setPass(v); setError('') }} placeholder="••••••••" />
        <Input label="Repetila" name="password2" autoComplete="new-password" type="password" value={pass2} onChange={v => { setPass2(v); setError('') }} placeholder="••••••••" />
        {error && <p className="text-sm text-red-500 text-center" role="alert">{error}</p>}
        <Btn type="submit" disabled={cargando}>{cargando ? 'Guardando…' : 'Guardar contraseña'}</Btn>
      </form>
    </div>
  )
}

/* ─── Onboarding ─────────────────────────────────────────────────────────── */

function OnboardingScreen({
  step, setStep, name, setName, salary, setSalary, payday, setPayday,
  varEstimate, setVarEstimate, fixedExpenses, setFixedExpenses,
  debts, setDebts, marital, setMarital, children, setChildren,
  savingsGoal, setSavingsGoal, onFinish,
}: {
  step: number; setStep: (n: number) => void
  name: string; setName: (v: string) => void
  salary: number; setSalary: (v: number) => void
  payday: number; setPayday: (v: number) => void
  varEstimate: number; setVarEstimate: (v: number) => void
  fixedExpenses: FixedExpense[]; setFixedExpenses: (v: FixedExpense[]) => void
  debts: Debt[]; setDebts: (v: Debt[]) => void
  marital: string; setMarital: (v: string) => void
  children: Child[]; setChildren: (v: Child[]) => void
  savingsGoal: number; setSavingsGoal: (v: number) => void
  onFinish: () => void
}) {
  const [nfName, setNfName] = useState(''); const [nfAmount, setNfAmount] = useState(''); const [nfDay, setNfDay] = useState('')
  const [ndName, setNdName] = useState(''); const [ndBalance, setNdBalance] = useState(''); const [ndPayment, setNdPayment] = useState('')
  const [ncName, setNcName] = useState(''); const [ncAge, setNcAge] = useState(''); const [ncStudies, setNcStudies] = useState(false)
  const [ncSchool, setNcSchool] = useState<'publica' | 'privada'>('publica')
  const [stepError, setStepError] = useState('')
  // borradores de texto: así se puede escribir "850.000" con punto de miles
  const [sSalary, setSSalary] = useState(montoInput(salary))
  const [sPayday, setSPayday] = useState(payday ? String(payday) : '')
  const [sVar, setSVar] = useState(montoInput(varEstimate))
  const [sSavings, setSSavings] = useState(montoInput(savingsGoal))

  const addFixed = () => {
    const amount = parseMonto(nfAmount)
    const dueDay = Number(nfDay)
    if (!nfName.trim() || !Number.isFinite(amount) || amount <= 0) {
      setStepError('Completá el nombre y un monto mayor a cero.')
      return
    }
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
      setStepError('El vencimiento debe ser un día entre 1 y 31.')
      return
    }
    setFixedExpenses([...fixedExpenses, { id: uid(), name: nfName.trim(), amount, dueDay, active: true }])
    setNfName(''); setNfAmount(''); setNfDay('')
    setStepError('')
  }
  const addDebt = () => {
    const balance = ndBalance.trim() === '' ? 0 : parseMonto(ndBalance)
    const payment = parseMonto(ndPayment)
    if (!ndName.trim() || !Number.isFinite(payment) || payment <= 0) {
      setStepError('Completá el nombre y una cuota mensual mayor a cero.')
      return
    }
    if (!Number.isFinite(balance) || balance < 0) {
      setStepError('El saldo pendiente no puede ser negativo.')
      return
    }
    setDebts([...debts, { id: uid(), name: ndName.trim(), balance, monthlyPayment: payment }])
    setNdName(''); setNdBalance(''); setNdPayment('')
    setStepError('')
  }
  const addChild = () => {
    const age = Number(ncAge)
    if (!ncName.trim()) {
      setStepError('Ingresá el nombre del hijo o hija.')
      return
    }
    if (!Number.isInteger(age) || age < 0 || age > 120) {
      setStepError('Ingresá una edad válida.')
      return
    }
    setChildren([...children, { id: uid(), name: ncName.trim(), age, studies: ncStudies, schoolType: ncStudies ? ncSchool : null }])
    setNcName(''); setNcAge(''); setNcStudies(false)
    setStepError('')
  }

  const STEPS = ['Sueldo','Fijos','Variables','Deudas','Familia','Listo']
  const continueOnboarding = () => {
    let error = ''
    const nSalary = parseMonto(sSalary)
    const nPayday = Number(sPayday)
    const nVar = sVar.trim() === '' ? 0 : parseMonto(sVar)
    const nSavings = sSavings.trim() === '' ? 0 : parseMonto(sSavings)
    if (step === 1 && (!Number.isFinite(nSalary) || nSalary <= 0)) error = 'Ingresá un sueldo mensual mayor a cero.'
    else if (step === 1 && (!Number.isInteger(nPayday) || nPayday < 1 || nPayday > 31)) error = 'El día de cobro debe estar entre 1 y 31.'
    else if (step === 3 && (!Number.isFinite(nVar) || nVar < 0)) error = 'Revisá el estimado: tiene que ser un monto (puede quedar vacío).'
    else if (step === 6 && !name.trim()) error = 'Ingresá tu nombre para terminar.'
    else if (step === 6 && (!Number.isFinite(nSavings) || nSavings < 0)) error = 'La meta de ahorro tiene que ser un monto (puede quedar vacía).'

    if (!error && step === 1) { setSalary(nSalary); setPayday(nPayday) }
    if (!error && step === 3) setVarEstimate(nVar)
    if (!error && step === 6) setSavingsGoal(nSavings)
    if (error) {
      setStepError(error)
      return
    }
    setStepError('')
    if (step < 6) setStep(step + 1)
    else onFinish()
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden screen-enter">
      <div className="px-5 pt-12 pb-4 flex-shrink-0">
        <div className="flex gap-1.5 mb-5">
          {STEPS.map((_, i) => (
            <div key={i} className="h-1 flex-1 rounded-full transition-all duration-400"
              style={{ background: i < step ? '#E8A33D' : 'var(--border)' }} />
          ))}
        </div>
        <p className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
          Paso {step} de 6 — {STEPS[step - 1]}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        {step === 1 && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-3xl font-bold" style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--fg)' }}>Tu sueldo</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>El neto que te entra en la cuenta cada mes.</p>
            </div>
            <Input label="Sueldo neto mensual" value={sSalary} onChange={v => { setSSalary(v); setStepError('') }} type="money" placeholder="850.000" />
            <Input label="Día de cobro" value={sPayday} onChange={v => { setSPayday(v); setStepError('') }} type="int" placeholder="5" />
          </div>
        )}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-3xl font-bold" style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--fg)' }}>Gastos fijos</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Alquiler, servicios, suscripciones.</p>
            </div>
            {fixedExpenses.map(fe => (
              <div key={fe.id} className="rounded-2xl px-4 py-3 flex items-center justify-between" style={{ background: 'var(--card)' }}>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>{fe.name}</p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>Vence día {fe.dueDay}</p>
                </div>
                <span className="text-sm font-medium" style={{ color: 'var(--fg)' }}>{fmt(fe.amount)}</span>
              </div>
            ))}
            <div className="rounded-2xl p-4 flex flex-col gap-3 border border-dashed border-[#E8A33D]/50" style={{ background: 'var(--card)' }}>
              <Input label="Nombre" value={nfName} onChange={setNfName} placeholder="Alquiler" />
              <div className="flex gap-3">
                <div className="flex-1"><Input label="Monto" value={nfAmount} onChange={setNfAmount} type="money" placeholder="20.000" /></div>
                <div className="w-24"><Input label="Día vence" value={nfDay} onChange={setNfDay} type="int" placeholder="1" /></div>
              </div>
              <button onClick={addFixed} className="text-sm font-semibold text-[#E8A33D] text-left transition-opacity hover:opacity-75 active:scale-[0.97]">+ Agregar</button>
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-3xl font-bold" style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--fg)' }}>Variables</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Cuánto querés gastar por mes en el día a día: comida, transporte, salidas, etc.</p>
            </div>
            <Input label="Estimado mensual" value={sVar} onChange={v => { setSVar(v); setStepError('') }} type="money" placeholder="120.000" />
            <div className="bg-[#E8A33D]/10 rounded-2xl p-4">
              <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>Con este monto calculamos cuánto podés gastar cada día hasta tu próximo cobro. Cada gasto que cargues se descuenta de acá. Si lo dejás vacío, usamos todo lo que te queda después de fijos, deudas y ahorro. Lo podés cambiar después desde el perfil.</p>
            </div>
          </div>
        )}
        {step === 4 && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-3xl font-bold" style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--fg)' }}>Deudas y tarjetas</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Cuotas, tarjetas, prestamos.</p>
            </div>
            {debts.map(d => (
              <div key={d.id} className="rounded-2xl px-4 py-3 flex items-center justify-between" style={{ background: 'var(--card)' }}>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>{d.name}</p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>Saldo: {fmt(d.balance)}</p>
                </div>
                <span className="text-sm font-medium" style={{ color: 'var(--fg)' }}>{fmt(d.monthlyPayment)}/mes</span>
              </div>
            ))}
            <div className="rounded-2xl p-4 flex flex-col gap-3 border border-dashed border-[#E8A33D]/50" style={{ background: 'var(--card)' }}>
              <Input label="Nombre" value={ndName} onChange={setNdName} placeholder="Tarjeta Visa" />
              <Input label="Saldo pendiente" value={ndBalance} onChange={setNdBalance} type="money" placeholder="150.000" />
              <Input label="Cuota mensual" value={ndPayment} onChange={setNdPayment} type="money" placeholder="30.000" />
              <button onClick={addDebt} className="text-sm font-semibold text-[#E8A33D] text-left transition-opacity hover:opacity-75 active:scale-[0.97]">+ Agregar</button>
            </div>
          </div>
        )}
        {step === 5 && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-3xl font-bold" style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--fg)' }}>Tu familia</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Estado civil e hijos a cargo. Este paso es opcional.</p>
            </div>
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>Estado civil</p>
              <div className="flex flex-wrap gap-2">
                {MARITAL.map(m => (
                  <button key={m.id} onClick={() => setMarital(m.id)}
                    className="px-4 py-2 rounded-full text-sm font-medium transition-all duration-150 active:scale-[0.96]"
                    style={{
                      background: marital === m.id ? 'var(--fg)' : 'var(--card)',
                      color: marital === m.id ? 'var(--bg)' : 'var(--fg)',
                    }}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            {children.length > 0 && (
              <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--card)' }}>
                {children.map((c, i) => (
                  <div key={c.id} className="flex items-center justify-between px-4 py-3"
                    style={{ borderBottom: i < children.length - 1 ? '1px solid var(--divider)' : 'none' }}>
                    <span className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>{c.name}</span>
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>{c.age} años</span>
                  </div>
                ))}
              </div>
            )}
            <div className="rounded-2xl p-4 flex flex-col gap-3 border border-dashed border-[#E8A33D]/50" style={{ background: 'var(--card)' }}>
              <div className="flex gap-3">
                <div className="flex-1"><Input label="Nombre" value={ncName} onChange={setNcName} placeholder="Valentina" /></div>
                <div className="w-20"><Input label="Edad" value={ncAge} onChange={setNcAge} type="int" placeholder="8" /></div>
              </div>
              <div className="flex items-center justify-between py-0.5">
                <span className="text-sm" style={{ color: 'var(--fg)' }}>¿Estudia?</span>
                <Toggle value={ncStudies} onChange={setNcStudies} label="Indicar si estudia" />
              </div>
              {ncStudies && (
                <div className="flex gap-2">
                  {(['publica', 'privada'] as const).map(t => (
                    <button key={t} onClick={() => setNcSchool(t)}
                      className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 active:scale-[0.97]"
                      style={{
                        background: ncSchool === t ? 'var(--fg)' : 'var(--subtle)',
                        color: ncSchool === t ? 'var(--bg)' : 'var(--fg)',
                      }}>
                      {t === 'publica' ? 'Pública' : 'Privada'}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={addChild} className="text-sm font-semibold text-[#E8A33D] text-left transition-opacity hover:opacity-75 active:scale-[0.97]">+ Agregar hijo/a</button>
            </div>
          </div>
        )}
        {step === 6 && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-3xl font-bold" style={{ fontFamily: '"DM Serif Display", serif', fontStyle: 'italic', color: 'var(--fg)' }}>Casi listo.</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Un nombre y una meta, y arrancamos.</p>
            </div>
            <Input label="Tu nombre" value={name} onChange={v => { setName(v); setStepError('') }} placeholder="Martín" />
            <Input label="Meta de ahorro mensual (opcional)" value={sSavings} onChange={v => { setSSavings(v); setStepError('') }} type="money" placeholder="50.000" />
            <div className="bg-[#E8A33D]/10 rounded-2xl p-4">
              <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                La meta de ahorro se reserva antes de calcular lo que podés gastar, para que llegues al próximo cobro con ese colchón.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="px-5 pb-10 pt-3 flex gap-3 flex-shrink-0">
        <div className="w-full">
          {stepError && <p className="text-xs text-red-500 mb-3 text-center" role="alert">{stepError}</p>}
          <div className="flex gap-3">
            {step > 1 && <Btn variant="ghost" onClick={() => { setStepError(''); setStep(step - 1) }} className="flex-none w-auto px-6">Atrás</Btn>}
            <Btn onClick={continueOnboarding}>{step < 6 ? 'Continuar' : 'Finalizar'}</Btn>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Menu drawer ────────────────────────────────────────────────────────── */

function MenuDrawer({ name, email, darkMode, onToggleDark, onNavigate, onClose, onLogout }: {
  name: string; email: string; darkMode: boolean; onToggleDark: () => void
  onNavigate: (s: Screen) => void; onClose: () => void; onLogout: () => void
}) {
  const items: { icon: React.ReactNode; label: string; screen: Screen }[] = [
    { icon: <IconUser />,     label: 'Perfil',             screen: 'profile'       },
    { icon: <IconChildren />, label: 'Hijos',              screen: 'children'      },
    { icon: <IconList />,     label: 'Fijos y deudas',     screen: 'fixed'         },
    { icon: <IconHistory />,  label: 'Historial',          screen: 'history'       },
    { icon: <IconShared />,   label: 'Compartidos',        screen: 'shared'        },
    { icon: <IconReports />,  label: 'Reportes',           screen: 'reports'       },
    { icon: <IconImport />,   label: 'Importar extracto',  screen: 'import'        },
    { icon: <IconBell />,     label: 'Notificaciones',     screen: 'notifications' },
  ]
  return (
    <>
      <div className="absolute inset-0 bg-black/50 z-20 fade-in" onClick={onClose} aria-hidden="true" />
      <div className="absolute left-0 top-0 bottom-0 w-72 z-30 flex flex-col shadow-2xl drawer-in"
        style={{ background: 'var(--drawer-body)' }}>
        <div className="pt-14 px-6 pb-6" style={{ background: 'var(--drawer-head)' }}>
          <div className="w-14 h-14 rounded-2xl bg-[#E8A33D] flex items-center justify-center mb-4">
            <span className="text-2xl font-bold" style={{ fontFamily: '"DM Serif Display", serif', color: ON_ACCENT }}>
              {(name.trim().charAt(0) || '?').toUpperCase()}
            </span>
          </div>
          <p className="font-bold text-lg text-white">{name}</p>
          <p className="text-white/50 text-sm mt-0.5 truncate">{email}</p>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {items.map(item => (
            <button key={item.screen} onClick={() => onNavigate(item.screen)}
              className="w-full flex items-center gap-4 px-6 py-4 transition-colors duration-150 text-left active:scale-[0.98]"
              style={{ color: 'var(--fg)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--subtle)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <span style={{ color: 'var(--muted)' }}>{item.icon}</span>
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
          {/* Dark mode toggle row */}
          <div className="flex items-center gap-4 px-6 py-4" style={{ borderTop: '1px solid var(--divider)' }}>
            <span style={{ color: 'var(--muted)' }}>{darkMode ? <IconSun /> : <IconMoon />}</span>
            <span className="font-medium flex-1" style={{ color: 'var(--fg)' }}>Modo oscuro</span>
            <Toggle value={darkMode} onChange={onToggleDark} label="Alternar modo oscuro" />
          </div>
        </div>
        <button onClick={onLogout} aria-label="Cerrar sesión"
          className="flex items-center gap-4 px-6 py-5 transition-colors duration-150 active:opacity-75"
          style={{ borderTop: '1px solid var(--divider)', color: 'var(--muted)' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}>
          <IconLogout />
          <span className="font-medium">Cerrar sesión</span>
        </button>
      </div>
    </>
  )
}

/* ─── Expense item ───────────────────────────────────────────────────────── */

/** Un movimiento de la lista: un gasto o un ingreso extra */
type Mov = { kind: 'gasto'; item: Expense } | { kind: 'ingreso'; item: Income }

function MovRow({ mov, isLast, onDelete, onEdit }: {
  mov: Mov; isLast: boolean; onDelete: (mov: Mov) => void; onEdit: (mov: Mov) => void
}) {
  const [hovered, setHovered] = useState(false)
  const { categories } = useCategories()
  const esIngreso = mov.kind === 'ingreso'
  const cat = esIngreso ? null : catInfo(mov.item.category, categories)
  const titulo = mov.item.concept || (esIngreso ? 'Ingreso extra' : cat!.label)
  return (
    <div
      className="flex items-center gap-3 px-4 py-3.5 transition-colors duration-150"
      style={{ borderBottom: !isLast ? '1px solid var(--divider)' : 'none', background: hovered ? 'var(--subtle)' : 'transparent' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: esIngreso ? '#22C55E' : cat!.color }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>{titulo}</p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>{esIngreso ? 'Ingreso extra' : cat!.label}</p>
      </div>
      <span className="text-sm font-semibold flex-shrink-0" style={{ color: esIngreso ? '#16A34A' : 'var(--fg)' }}>
        {esIngreso ? '+' : ''}{fmt(mov.item.amount)}
      </span>
      <div className="flex items-center gap-1">
        <button onClick={() => onEdit(mov)} aria-label={`Editar ${titulo}`}
          className={`w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--subtle)] transition-all flex-shrink-0 active:scale-90 ${hovered ? 'opacity-100' : 'opacity-60'}`}
          style={{ color: 'var(--muted)' }}>
          <IconEdit />
        </button>
        <button onClick={() => onDelete(mov)} aria-label={`Eliminar ${titulo}`}
          className={`w-8 h-8 rounded-full flex items-center justify-center text-red-400 hover:bg-red-500/10 transition-all flex-shrink-0 active:scale-90 ${hovered ? 'opacity-100' : 'opacity-60'}`}>
          <IconX />
        </button>
      </div>
    </div>
  )
}

/* ─── Home screen ────────────────────────────────────────────────────────── */

function HomeScreen({ name, availableToday, todaySpent, dailyBudget, remainingDays, movs, unreadCount, darkMode, sync, onToggleDark, onAddExpense, onOpenMenu, onOpenNotifications, onDelete, onEdit }: {
  name: string; availableToday: number; todaySpent: number; dailyBudget: number
  remainingDays: number
  movs: Mov[]; unreadCount: number; darkMode: boolean; sync: string | null; onToggleDark: () => void
  onAddExpense: () => void; onOpenMenu: () => void; onOpenNotifications: () => void
  onDelete: (mov: Mov) => void; onEdit: (mov: Mov) => void
}) {
  const today = new Date()
  const dayName = today.toLocaleDateString('es-AR', { weekday: 'long' })
  const dateLabel = today.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })
  const ratio = dailyBudget > 0 ? availableToday / dailyBudget : 0
  const availColor = availableToday < 0 ? '#EF4444' : ratio < 0.25 ? '#F97316' : '#E8A33D'

  return (
    <div className="flex-1 flex flex-col overflow-hidden screen-enter">
      {/* Header */}
      <div className="px-5 pt-10 pb-2 flex items-center justify-between flex-shrink-0">
        <button onClick={onOpenMenu} aria-label="Abrir menú"
          className="w-10 h-10 flex items-center justify-center rounded-full transition-all duration-150 active:scale-[0.90] -ml-2"
          style={{ color: 'var(--fg)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--subtle)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
          <svg width="22" height="15" viewBox="0 0 22 15" fill="none">
            <path d="M1 1.5H21M1 7.5H14M1 13.5H21" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
          </svg>
        </button>
        <div className="flex items-center gap-1.5">
          <div className="text-right mr-1">
            <p className="text-xs capitalize" style={{ color: 'var(--muted)' }}>{dayName}</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>{dateLabel}</p>
          </div>
          <button onClick={onToggleDark} aria-label={darkMode ? 'Activar modo claro' : 'Activar modo oscuro'}
            className="w-9 h-9 flex items-center justify-center rounded-full transition-all duration-150 active:scale-[0.90]"
            style={{ color: 'var(--muted)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--subtle)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            {darkMode ? <IconSun /> : <IconMoon />}
          </button>
          <button onClick={onOpenNotifications} aria-label={`Abrir notificaciones${unreadCount > 0 ? `, ${unreadCount} sin leer` : ''}`}
            className="relative w-9 h-9 flex items-center justify-center rounded-full transition-all duration-150 active:scale-[0.90]"
            style={{ color: 'var(--muted)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--subtle)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <IconBell />
            {unreadCount > 0 && (
              <span key={unreadCount} className="absolute top-0.5 right-0.5 w-[18px] h-[18px] rounded-full bg-[#E8A33D] flex items-center justify-center badge-pop notif-pulse"
                style={{ fontSize: 9, fontWeight: 800, color: ON_ACCENT }}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-28">
        <div className="flex items-center justify-between mb-5 gap-3">
          <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>Hola{name ? `, ${name}` : ''}</p>
          {sync && (
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" role="status"
              style={{ background: 'var(--subtle)', color: 'var(--muted)' }}>{sync}</span>
          )}
        </div>

        {/* Hero number */}
        <div className="mb-8">
          <p className="text-[12px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>
            Podés gastar hoy
          </p>
          <div className="leading-none mb-1.5 break-words"
            style={{ fontFamily: '"DM Serif Display", serif', fontStyle: 'italic', fontSize: 'clamp(2.6rem, 14vw, 4rem)', fontWeight: 700, color: availColor, letterSpacing: '-0.025em' }}>
            {fmt(availableToday)}
          </div>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            sin comprometer los {remainingDays} {remainingDays === 1 ? 'día' : 'días'} hasta tu próximo cobro
          </p>
        </div>

        {/* Daily card */}
        <div className="rounded-2xl px-5 py-4 mb-6 transition-shadow duration-200 hover:shadow-md"
          style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Gastado hoy</p>
              <p className="text-2xl font-bold mt-0.5" style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--fg)' }}>{fmt(todaySpent)}</p>
            </div>
            <div className="text-right">
              <p className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Presupuesto</p>
              <p className="text-base font-semibold mt-0.5" style={{ color: 'var(--muted)' }}>{fmt(dailyBudget)}</p>
            </div>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--subtle)' }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.min(100, dailyBudget > 0 ? (todaySpent / dailyBudget) * 100 : todaySpent > 0 ? 100 : 0)}%`, background: availColor }} />
          </div>
        </div>

        {/* Movimientos de hoy */}
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>Movimientos de hoy</p>
          {movs.length === 0 ? (
            <div className="rounded-2xl px-5 py-8 text-center" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>Todavía no cargaste gastos hoy.</p>
              <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Tocá el + para agregar uno.</p>
            </div>
          ) : (
            <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
              {movs.map((mov, i) => (
                <MovRow key={mov.item.id} mov={mov} isLast={i === movs.length - 1} onDelete={onDelete} onEdit={onEdit} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* FAB */}
      <button onClick={onAddExpense} aria-label="Agregar gasto o ingreso"
        className="absolute bottom-7 right-6 w-14 h-14 rounded-full bg-[#E8A33D] flex items-center justify-center transition-transform duration-150 active:scale-90 hover:scale-105 fab-animated"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <path d="M11 3V19M3 11H19" stroke={ON_ACCENT} strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}

/* ─── Ventana de gasto / ingreso ─────────────────────────────────────────── */

function ExpenseModal({ mov, onSave, onClose }: {
  mov?: Mov | null
  onSave: (kind: Mov['kind'], data: { amount: number; concept: string; category: string; date: string }) => void
  onClose: () => void
}) {
  const editing = Boolean(mov)
  const [kind, setKind] = useState<Mov['kind']>(mov?.kind ?? 'gasto')
  const [amount, setAmount] = useState(mov ? montoInput(mov.item.amount) : '')
  const [concept, setConcept] = useState(mov?.item.concept ?? '')
  const [cat, setCat] = useState(mov?.kind === 'gasto' ? mov.item.category : 'otros')
  const [date, setDate] = useState(mov?.item.date ?? todayStr())
  const [showNewCat, setShowNewCat] = useState(false)
  const [newCatLabel, setNewCatLabel] = useState('')
  const [amountError, setAmountError] = useState('')
  const [categoryError, setCategoryError] = useState('')
  const { categories, addCategory } = useCategories()
  const esIngreso = kind === 'ingreso'

  const handleSave = () => {
    const n = parseMonto(amount)
    if (!Number.isFinite(n) || n <= 0) {
      setAmountError('Ingresá un monto mayor a cero.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayStr()) {
      setAmountError('Elegí una fecha de hoy o anterior.')
      return
    }
    onSave(kind, { amount: n, concept: concept.trim(), category: cat, date })
  }

  const addCustom = () => {
    const label = newCatLabel.trim()
    if (!label) { setCategoryError('Escribí un nombre para la categoría.'); return }
    if (categories.some(c => c.label.toLocaleLowerCase('es') === label.toLocaleLowerCase('es'))) {
      setCategoryError('Ya existe una categoría con ese nombre.')
      return
    }
    const colors = ['#EC4899', '#14B8A6', '#F59E0B', '#84CC16']
    const category = { id: `custom-${uid()}`, label, color: colors[categories.length % colors.length] }
    addCategory(category)
    setCat(category.id)
    setNewCatLabel(''); setCategoryError(''); setShowNewCat(false)
  }

  const titulo = editing ? (esIngreso ? 'Editar ingreso' : 'Editar gasto') : (esIngreso ? 'Nuevo ingreso extra' : 'Nuevo gasto')

  return (
    <>
      <div className="absolute inset-0 bg-black/50 z-20 fade-in" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={titulo}
        className="absolute bottom-0 left-0 right-0 rounded-t-3xl z-30 flex flex-col sheet-up" style={{ maxHeight: '92%', background: 'var(--bg)' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <div className="px-5 pb-2 pt-1 flex items-center justify-between flex-shrink-0">
          <h3 className="text-lg font-bold" style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--fg)' }}>{titulo}</h3>
          <button onClick={onClose} aria-label="Cerrar"
            className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 active:scale-90"
            style={{ background: 'var(--card)', color: 'var(--muted)' }}>
            <IconClose />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {!editing && (
            <div className="flex rounded-2xl p-1 mb-4" style={{ background: 'var(--card)' }}>
              {(['gasto', 'ingreso'] as const).map(k => (
                <button key={k} onClick={() => { setKind(k); setAmountError('') }}
                  className="flex-1 py-2 rounded-xl text-sm font-semibold transition-all duration-150 active:scale-[0.97]"
                  style={{ background: kind === k ? 'var(--fg)' : 'transparent', color: kind === k ? 'var(--bg)' : 'var(--muted)' }}>
                  {k === 'gasto' ? 'Gasto' : 'Ingreso extra'}
                </button>
              ))}
            </div>
          )}

          {/* Monto */}
          <div className="rounded-2xl px-5 pt-5 pb-5 text-center mb-4" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
            <label htmlFor="monto-mov" className="block text-[12px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>Monto</label>
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-2xl font-bold" style={{ fontFamily: '"DM Serif Display", serif', color: esIngreso ? '#16A34A' : 'var(--muted)' }}>{esIngreso ? '+$' : '$'}</span>
              <input id="monto-mov" type="text" inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setAmountError('') }} placeholder="0" autoFocus
                aria-invalid={Boolean(amountError)} aria-describedby={amountError ? 'expense-amount-error' : undefined}
                onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
                className="bg-transparent outline-none text-center w-full max-w-[220px]"
                style={{ fontFamily: '"DM Serif Display", serif', fontSize: '3rem', fontWeight: 700, color: 'var(--fg)', outline: 'none' }} />
            </div>
            {amountError && <p id="expense-amount-error" className="text-xs text-red-500 mt-2" role="alert">{amountError}</p>}
          </div>

          {/* Descripción y fecha */}
          <div className="flex gap-2 mb-4">
            <input type="text" value={concept} onChange={e => setConcept(e.target.value)}
              placeholder={esIngreso ? 'De dónde vino (opcional)' : 'Descripción (opcional)'} aria-label="Descripción"
              className="flex-1 min-w-0 rounded-xl px-4 py-3.5 text-base outline-none transition-all duration-200"
              style={{ background: 'var(--card)', color: 'var(--fg)', border: '1.5px solid var(--border)' }}
              onFocus={e => { e.currentTarget.style.borderColor = '#E8A33D' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }} />
            <input type="date" value={date} max={todayStr()} onChange={e => { setDate(e.target.value); setAmountError('') }} aria-label="Fecha"
              className="w-[9.5rem] rounded-xl px-3 py-3.5 text-sm outline-none"
              style={{ background: 'var(--card)', color: 'var(--fg)', border: '1.5px solid var(--border)', colorScheme: 'light dark' }} />
          </div>

          {/* Categorías (solo gastos) */}
          {!esIngreso && (
            <>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {categories.map(c => (
                  <button key={c.id} onClick={() => setCat(c.id)} aria-pressed={cat === c.id}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-150 active:scale-[0.95]"
                    style={{
                      background: cat === c.id ? 'var(--fg)' : 'var(--card)',
                      color: cat === c.id ? 'var(--bg)' : 'var(--fg)',
                      transform: cat === c.id ? 'scale(1.02)' : 'scale(1)',
                    }}>
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
                    <span className="text-sm font-medium truncate">{c.label}</span>
                  </button>
                ))}
              </div>
              {showNewCat ? (
                <div className="flex gap-2 mb-3">
                  <input value={newCatLabel} onChange={e => { setNewCatLabel(e.target.value); setCategoryError('') }} placeholder="Nueva categoría" aria-label="Nueva categoría"
                    className="flex-1 rounded-xl px-4 py-3 text-base outline-none"
                    style={{ background: 'var(--card)', color: 'var(--fg)', border: '1.5px solid var(--border)' }} />
                  <button onClick={addCustom} className="px-4 py-2 bg-[#E8A33D] rounded-xl text-sm font-semibold transition-all duration-150 active:scale-[0.95]"
                    style={{ color: ON_ACCENT }}>OK</button>
                </div>
              ) : (
                <button onClick={() => setShowNewCat(true)} className="text-sm font-semibold text-[#E8A33D] mb-3 block transition-opacity hover:opacity-75 active:scale-[0.97]">
                  + Nueva categoría
                </button>
              )}
              {categoryError && <p className="text-xs text-red-500 mb-3" role="alert">{categoryError}</p>}
            </>
          )}
          {esIngreso && (
            <div className="bg-[#E8A33D]/10 rounded-2xl p-4">
              <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                Plata que entra aparte del sueldo (una changa, un reintegro, una venta). Suma a lo que podés gastar en este ciclo.
              </p>
            </div>
          )}
        </div>
        <div className="px-5 pt-2 flex-shrink-0" style={{ paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom))' }}>
          <Btn onClick={handleSave}>{editing ? 'Guardar cambios' : 'Guardar'}</Btn>
        </div>
      </div>
    </>
  )
}

/* ─── History screen ─────────────────────────────────────────────────────── */

function HistoryScreen({ movs, onBack, onDelete, onEdit }: {
  movs: Mov[]; onBack: () => void; onDelete: (mov: Mov) => void; onEdit: (mov: Mov) => void
}) {
  const [cantidad, setCantidad] = useState(60)
  const groups: Record<string, Mov[]> = {}
  movs.forEach(m => { if (!groups[m.item.date]) groups[m.item.date] = []; groups[m.item.date].push(m) })
  const allDates = Object.keys(groups).sort((a, b) => b.localeCompare(a))
  const dates = allDates.slice(0, cantidad)

  return (
    <div className="flex-1 flex flex-col overflow-hidden screen-enter">
      <PageHeader title="Historial" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5 pb-8">
        {dates.length === 0 && <p className="text-center text-sm py-12" style={{ color: 'var(--muted)' }}>No hay movimientos registrados.</p>}
        {dates.map(date => {
          const dayMovs = groups[date]
          const dayTotal = dayMovs.filter(m => m.kind === 'gasto').reduce((s, m) => s + m.item.amount, 0)
          return (
            <div key={date} className="mb-5">
              <div className="flex items-center justify-between mb-2.5">
                <p className="text-sm font-bold" style={{ color: 'var(--fg)' }}>{date === todayStr() ? 'Hoy' : fmtDate(date)}</p>
                {dayTotal > 0 && <p className="text-sm font-bold text-[#E8A33D]">{fmt(dayTotal)}</p>}
              </div>
              <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
                {dayMovs.map((mov, i) => (
                  <MovRow key={mov.item.id} mov={mov} isLast={i === dayMovs.length - 1} onDelete={onDelete} onEdit={onEdit} />
                ))}
              </div>
            </div>
          )
        })}
        {allDates.length > cantidad && (
          <Btn variant="ghost" onClick={() => setCantidad(c => c + 60)}>Ver días anteriores</Btn>
        )}
      </div>
    </div>
  )
}

/* ─── Fixed + debts screen ───────────────────────────────────────────────── */

function FixedScreen({ fixedExpenses, setFixedExpenses, debts, setDebts, cycleKey, onBack }: {
  fixedExpenses: FixedExpense[]; setFixedExpenses: (v: FixedExpense[]) => void
  debts: Debt[]; setDebts: (v: Debt[]) => void; cycleKey: string; onBack: () => void
}) {
  const [nfName, setNfName] = useState(''); const [nfAmount, setNfAmount] = useState(''); const [nfDay, setNfDay] = useState('')
  const [ndName, setNdName] = useState(''); const [ndBalance, setNdBalance] = useState(''); const [ndPayment, setNdPayment] = useState('')
  const [fixedError, setFixedError] = useState('')
  const [debtError, setDebtError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'fixed' | 'debt'; id: string; name: string } | null>(null)

  const addFixed = () => {
    const amount = parseMonto(nfAmount)
    const dueDay = Number(nfDay)
    if (!nfName.trim()) {
      setFixedError('Ingresá un nombre para el gasto.')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setFixedError('El monto debe ser mayor a cero.')
      return
    }
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
      setFixedError('El día de vencimiento debe estar entre 1 y 31.')
      return
    }
    setFixedExpenses([...fixedExpenses, { id: uid(), name: nfName.trim(), amount, dueDay, active: true }])
    setNfName(''); setNfAmount(''); setNfDay('')
    setFixedError('')
  }
  const addDebt = () => {
    const balance = ndBalance.trim() === '' ? 0 : parseMonto(ndBalance)
    const payment = parseMonto(ndPayment)
    if (!ndName.trim()) {
      setDebtError('Ingresá un nombre para la deuda.')
      return
    }
    if (!Number.isFinite(balance) || balance < 0) {
      setDebtError('El saldo pendiente no puede ser negativo.')
      return
    }
    if (!Number.isFinite(payment) || payment <= 0) {
      setDebtError('La cuota mensual debe ser mayor a cero.')
      return
    }
    setDebts([...debts, { id: uid(), name: ndName.trim(), balance, monthlyPayment: payment }])
    setNdName(''); setNdBalance(''); setNdPayment('')
    setDebtError('')
  }
  const toggle = (id: string) => setFixedExpenses(fixedExpenses.map(f => f.id === id ? { ...f, active: !f.active } : f))
  const toggleFixedPaid = (id: string) => setFixedExpenses(fixedExpenses.map(f =>
    f.id === id ? { ...f, lastPaidCycle: f.lastPaidCycle === cycleKey ? undefined : cycleKey } : f
  ))
  const toggleDebtPaid = (id: string) => setDebts(debts.map(debt => {
    if (debt.id !== id) return debt
    const isPaid = debt.lastPaidCycle === cycleKey
    const paymentAmount = Math.min(debt.balance, debt.monthlyPayment)
    return {
      ...debt,
      balance: isPaid
        ? debt.balance + (debt.lastPaymentAmount ?? debt.monthlyPayment)
        : debt.balance - paymentAmount,
      lastPaidCycle: isPaid ? undefined : cycleKey,
      lastPaymentAmount: isPaid ? undefined : paymentAmount,
    }
  }))
  const confirmDelete = () => {
    if (!pendingDelete) return
    if (pendingDelete.kind === 'fixed') {
      setFixedExpenses(fixedExpenses.filter(f => f.id !== pendingDelete.id))
    } else {
      setDebts(debts.filter(d => d.id !== pendingDelete.id))
    }
    setPendingDelete(null)
  }
  const totalFixed = fixedExpenses.filter(f => f.active).reduce((s, f) => s + f.amount, 0)
  const totalDebt = debtCommitment(debts, cycleKey)

  return (
    <div className="flex-1 flex flex-col overflow-hidden screen-enter">
      <PageHeader title="Fijos y deudas" onBack={onBack}
        right={<span className="text-xs" style={{ color: 'var(--muted)' }}>{fmt(totalFixed + totalDebt)}/mes</span>} />
      <div className="flex-1 overflow-y-auto px-5 pb-8">
        <p className="text-[12px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>Gastos fijos</p>
        <div className="rounded-2xl overflow-hidden mb-3" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
          {fixedExpenses.map((fe, i) => (
            <div key={fe.id} className="flex items-center gap-3 px-4 py-4"
              style={{ borderBottom: i < fixedExpenses.length - 1 ? '1px solid var(--divider)' : 'none' }}>
              <div className="flex-1">
                <p className="text-sm font-semibold transition-colors" style={{ color: fe.active ? 'var(--fg)' : 'var(--placeholder)' }}>{fe.name}</p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>Vence día {fe.dueDay} · {fmt(fe.amount)}</p>
                {fe.active && (
                  <button onClick={() => toggleFixedPaid(fe.id)}
                    className="text-xs font-semibold mt-1.5 transition-opacity hover:opacity-75 active:scale-[0.97]"
                    style={{ color: fe.lastPaidCycle === cycleKey ? '#22C55E' : '#E8A33D' }}>
                    {fe.lastPaidCycle === cycleKey ? 'Pagado este ciclo · Deshacer' : 'Marcar como pagado'}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
              <Toggle value={fe.active} onChange={() => toggle(fe.id)} label={`${fe.active ? 'Desactivar' : 'Activar'} ${fe.name}`} />
                <button
                  onClick={() => setPendingDelete({ kind: 'fixed', id: fe.id, name: fe.name })}
                  aria-label={`Eliminar ${fe.name}`}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-red-400 hover:bg-red-500/10 transition-all active:scale-90"
                >
                  <IconX />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-2xl p-4 mb-8 border border-dashed border-[#E8A33D]/40" style={{ background: 'var(--card)' }}>
          <div className="flex flex-col gap-3">
            <Input label="Nombre" value={nfName} onChange={v => { setNfName(v); setFixedError('') }} placeholder="Netflix" />
            <div className="flex gap-3">
              <div className="flex-1"><Input label="Monto" value={nfAmount} onChange={v => { setNfAmount(v); setFixedError('') }} type="money" placeholder="8.000" /></div>
              <div className="w-24"><Input label="Día" value={nfDay} onChange={v => { setNfDay(v); setFixedError('') }} type="int" placeholder="15" /></div>
            </div>
            {fixedError && <p className="text-xs text-red-500" role="alert">{fixedError}</p>}
            <button onClick={addFixed} className="text-sm font-semibold text-[#E8A33D] text-left transition-opacity hover:opacity-75 active:scale-[0.97]">+ Agregar gasto fijo</button>
          </div>
        </div>
        <p className="text-[12px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>Deudas</p>
        <div className="rounded-2xl overflow-hidden mb-3" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
          {debts.map((d, i) => (
            <div key={d.id} className="px-4 py-4"
              style={{ borderBottom: i < debts.length - 1 ? '1px solid var(--divider)' : 'none' }}>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>{d.name}</p>
                    <span className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>{fmt(d.monthlyPayment)}/mes</span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Saldo pendiente: {fmt(d.balance)}</p>
                  <button onClick={() => toggleDebtPaid(d.id)}
                    className="text-xs font-semibold mt-1.5 transition-opacity hover:opacity-75 active:scale-[0.97]"
                    style={{ color: d.lastPaidCycle === cycleKey ? '#22C55E' : '#E8A33D' }}>
                    {d.lastPaidCycle === cycleKey ? 'Cuota registrada · Deshacer' : 'Registrar cuota del ciclo'}
                  </button>
                </div>
                <button
                  onClick={() => setPendingDelete({ kind: 'debt', id: d.id, name: d.name })}
                  aria-label={`Eliminar ${d.name}`}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-red-400 hover:bg-red-500/10 transition-all active:scale-90"
                >
                  <IconX />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-2xl p-4 border border-dashed border-[#E8A33D]/40" style={{ background: 'var(--card)' }}>
          <div className="flex flex-col gap-3">
            <Input label="Nombre" value={ndName} onChange={v => { setNdName(v); setDebtError('') }} placeholder="Tarjeta Mastercard" />
            <Input label="Saldo pendiente" value={ndBalance} onChange={v => { setNdBalance(v); setDebtError('') }} type="money" placeholder="200.000" />
            <Input label="Cuota mensual" value={ndPayment} onChange={v => { setNdPayment(v); setDebtError('') }} type="money" placeholder="35.000" />
            {debtError && <p className="text-xs text-red-500" role="alert">{debtError}</p>}
            <button onClick={addDebt} className="text-sm font-semibold text-[#E8A33D] text-left transition-opacity hover:opacity-75 active:scale-[0.97]">+ Agregar deuda</button>
          </div>
        </div>
      </div>
      {pendingDelete && (
        <ConfirmDialog
          title={`¿Eliminar ${pendingDelete.name}?`}
          body={pendingDelete.kind === 'fixed'
            ? 'Este gasto dejará de descontarse de tu presupuesto mensual.'
            : 'Esta deuda dejará de descontarse del cálculo de tu disponible diario.'}
          confirmLabel="Eliminar"
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}

/* ─── Profile screen ─────────────────────────────────────────────────────── */

function ProfileScreen({ perfil, setPerfil, email, darkMode, onToggleDark, onDeleteAccount, onBack }: {
  perfil: Perfil; setPerfil: (p: Partial<Perfil>) => void; email: string
  darkMode: boolean; onToggleDark: () => void
  onDeleteAccount: () => Promise<string | null>
  onBack: () => void
}) {
  const [draftName, setDraftName] = useState(perfil.name)
  const [draftSalary, setDraftSalary] = useState(montoInput(perfil.salary))
  const [draftPayday, setDraftPayday] = useState(String(perfil.payday))
  const [draftVarEstimate, setDraftVarEstimate] = useState(montoInput(perfil.varEstimate))
  const [draftSavingsGoal, setDraftSavingsGoal] = useState(montoInput(perfil.savingsGoal))
  const [draftMarital, setDraftMarital] = useState(perfil.marital)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [confirmarBorrado, setConfirmarBorrado] = useState(false)
  const [borrando, setBorrando] = useState(false)

  const save = () => {
    const salaryValue = parseMonto(draftSalary)
    const paydayValue = Number(draftPayday)
    const variableValue = draftVarEstimate.trim() === '' ? 0 : parseMonto(draftVarEstimate)
    const savingsValue = draftSavingsGoal.trim() === '' ? 0 : parseMonto(draftSavingsGoal)
    if (!draftName.trim()) { setError('Ingresá tu nombre.'); return }
    if (!Number.isFinite(salaryValue) || salaryValue <= 0) { setError('El sueldo debe ser mayor a cero.'); return }
    if (!Number.isInteger(paydayValue) || paydayValue < 1 || paydayValue > 31) { setError('El día de cobro debe estar entre 1 y 31.'); return }
    if (!Number.isFinite(variableValue) || variableValue < 0) { setError('Revisá el estimado de gastos variables.'); return }
    if (!Number.isFinite(savingsValue) || savingsValue < 0) { setError('Revisá la meta de ahorro.'); return }
    setPerfil({
      name: draftName.trim(), salary: salaryValue, payday: paydayValue,
      varEstimate: variableValue, savingsGoal: savingsValue, marital: draftMarital,
    })
    onBack()
  }

  const cambiarClave = async () => {
    setAviso(''); setError('')
    const { error: e } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() })
    if (e) setError(errorAuth(e))
    else setAviso(`Te mandamos un link a ${email} para elegir una contraseña nueva.`)
  }

  const borrar = async () => {
    setBorrando(true)
    const err = await onDeleteAccount()
    setBorrando(false)
    if (err) { setConfirmarBorrado(false); setError(err) }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden screen-enter">
      <PageHeader title="Perfil" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5 pb-8">
        <div className="flex flex-col items-center py-7">
          <div className="w-20 h-20 rounded-full bg-[#E8A33D] flex items-center justify-center mb-3">
            <span className="text-3xl font-bold" style={{ fontFamily: '"DM Serif Display", serif', color: ON_ACCENT }}>
              {(draftName.trim().charAt(0) || '?').toUpperCase()}
            </span>
          </div>
          <p className="text-base font-bold" style={{ color: 'var(--fg)' }}>{draftName || 'Tu nombre'}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{email}</p>
        </div>
        <div className="flex flex-col gap-4">
          <Input label="Nombre" value={draftName} onChange={v => { setDraftName(v); setError('') }} />
          <Input label="Sueldo neto mensual" value={draftSalary} onChange={v => { setDraftSalary(v); setError('') }} type="money" placeholder="850.000" />
          <Input label="Día de cobro" value={draftPayday} onChange={v => { setDraftPayday(v); setError('') }} type="int" />
          <Input label="Presupuesto mensual para el día a día" value={draftVarEstimate} onChange={v => { setDraftVarEstimate(v); setError('') }} type="money" placeholder="Vacío = todo lo que queda" />
          <Input label="Meta de ahorro mensual" value={draftSavingsGoal} onChange={v => { setDraftSavingsGoal(v); setError('') }} type="money" placeholder="0" />
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>Estado civil</p>
            <div className="flex flex-wrap gap-2">
              {MARITAL.map(m => (
                <button key={m.id} onClick={() => { setDraftMarital(m.id); setError('') }}
                  className="px-4 py-2 rounded-full text-sm font-medium transition-all duration-150 active:scale-[0.96]"
                  style={{
                    background: draftMarital === m.id ? 'var(--fg)' : 'var(--card)',
                    color: draftMarital === m.id ? 'var(--bg)' : 'var(--fg)',
                  }}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between px-4 py-4 rounded-2xl" style={{ background: 'var(--card)' }}>
            <div className="flex items-center gap-3">
              <span style={{ color: 'var(--muted)' }}>{darkMode ? <IconSun /> : <IconMoon />}</span>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>Modo oscuro</p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>{darkMode ? 'Activado' : 'Desactivado'}</p>
              </div>
            </div>
            <Toggle value={darkMode} onChange={onToggleDark} label="Alternar modo oscuro" />
          </div>
        </div>
        {error && <p className="text-xs text-red-500 mt-5 text-center" role="alert">{error}</p>}
        <div className="mt-6"><Btn onClick={save}>Guardar cambios</Btn></div>

        <p className="text-[12px] font-semibold uppercase tracking-widest mt-10 mb-3" style={{ color: 'var(--muted)' }}>Cuenta</p>
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
          <button onClick={() => void cambiarClave()} className="w-full text-left px-4 py-4 text-sm font-medium" style={{ color: 'var(--fg)', borderBottom: '1px solid var(--divider)' }}>
            Cambiar contraseña
          </button>
          <button onClick={() => setConfirmarBorrado(true)} className="w-full text-left px-4 py-4 text-sm font-medium text-red-500">
            Eliminar mi cuenta
          </button>
        </div>
        {aviso && <p className="text-xs mt-3 text-center" role="status" style={{ color: 'var(--muted)' }}>{aviso}</p>}
      </div>
      {confirmarBorrado && (
        <ConfirmDialog
          title="¿Eliminar tu cuenta?"
          body="Se borran para siempre tu cuenta y todos tus datos: gastos, fijos, deudas, compartidos y configuración. No se puede deshacer."
          confirmLabel={borrando ? 'Eliminando…' : 'Eliminar todo'}
          onConfirm={() => { if (!borrando) void borrar() }}
          onClose={() => { if (!borrando) setConfirmarBorrado(false) }}
        />
      )}
    </div>
  )
}

/* ─── Children screen ────────────────────────────────────────────────────── */

function ChildrenScreen({ children, setChildren, onBack }: {
  children: Child[]; setChildren: (v: Child[]) => void; onBack: () => void
}) {
  const [newName, setNewName] = useState(''); const [newAge, setNewAge] = useState('')
  const [newStudies, setNewStudies] = useState(false); const [newSchool, setNewSchool] = useState<'publica' | 'privada'>('publica')

  const [error, setError] = useState('')
  const add = () => {
    const age = Number(newAge)
    if (!newName.trim()) { setError('Ingresá el nombre del hijo o hija.'); return }
    if (newAge.trim() === '' || !Number.isInteger(age) || age < 0 || age > 120) { setError('Ingresá una edad válida.'); return }
    setChildren([...children, { id: uid(), name: newName.trim(), age, studies: newStudies, schoolType: newStudies ? newSchool : null }])
    setNewName(''); setNewAge(''); setNewStudies(false); setError('')
  }
  const remove = (id: string) => setChildren(children.filter(c => c.id !== id))

  return (
    <div className="flex-1 flex flex-col overflow-hidden screen-enter">
      <PageHeader title="Hijos" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5 pb-8">
        {children.length > 0 ? (
          <div className="rounded-2xl overflow-hidden mb-6" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
            {children.map((c, i) => (
              <div key={c.id} className="flex items-center gap-4 px-4 py-4"
                style={{ borderBottom: i < children.length - 1 ? '1px solid var(--divider)' : 'none' }}>
                <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'var(--subtle)' }}>
                  <span className="text-sm font-bold" style={{ color: 'var(--muted)' }}>{c.name.charAt(0)}</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold" style={{ color: 'var(--fg)' }}>{c.name}</p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>{c.age} años{c.studies ? ` · ${c.schoolType === 'publica' ? 'Pública' : 'Privada'}` : ' · No estudia'}</p>
                </div>
                <button onClick={() => remove(c.id)} className="transition-all duration-150 active:scale-90"
                  style={{ color: 'var(--placeholder)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--placeholder)')}>
                  <IconX />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-center py-8 mb-4" style={{ color: 'var(--muted)' }}>No hay hijos registrados.</p>
        )}
        <p className="text-[12px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>Agregar hijo/a</p>
        <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
          <div className="flex gap-3">
            <div className="flex-1"><Input label="Nombre" value={newName} onChange={v => { setNewName(v); setError('') }} placeholder="Valentina" /></div>
            <div className="w-20"><Input label="Edad" value={newAge} onChange={v => { setNewAge(v); setError('') }} type="int" placeholder="8" /></div>
          </div>
          <div className="flex items-center justify-between py-0.5">
            <span className="text-sm" style={{ color: 'var(--fg)' }}>¿Estudia?</span>
            <Toggle value={newStudies} onChange={setNewStudies} label="Indicar si estudia" />
          </div>
          {newStudies && (
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--muted)' }}>Tipo de institución</p>
              <div className="flex gap-2">
                {(['publica', 'privada'] as const).map(t => (
                  <button key={t} onClick={() => setNewSchool(t)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 active:scale-[0.97]"
                    style={{
                      background: newSchool === t ? 'var(--fg)' : 'var(--subtle)',
                      color: newSchool === t ? 'var(--bg)' : 'var(--fg)',
                    }}>
                    {t === 'publica' ? 'Pública' : 'Privada'}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && <p className="text-xs text-red-500" role="alert">{error}</p>}
          <Btn onClick={add}>Agregar hijo/a</Btn>
        </div>
      </div>
    </div>
  )
}

/* ─── Shared expenses screen ─────────────────────────────────────────────── */

function SharedScreen({ people, setPeople, sharedExpenses, setSharedExpenses, onBack }: {
  people: SharedPerson[]; setPeople: (v: SharedPerson[]) => void
  sharedExpenses: SharedExpense[]; setSharedExpenses: (v: SharedExpense[]) => void
  onBack: () => void
}) {
  const { categories } = useCategories()
  const [tab, setTab] = useState('Gastos')
  const [selectedPerson, setSelectedPerson] = useState(people[0]?.id ?? '')
  // si las personas llegan después (al cargar de la nube), elegir la primera
  useEffect(() => {
    if (!people.some(p => p.id === selectedPerson) && people[0]) setSelectedPerson(people[0].id)
  }, [people, selectedPerson])
  const [newPersonName, setNewPersonName] = useState('')
  const [showAddPerson, setShowAddPerson] = useState(false)
  const [nAmount, setNAmount] = useState(''); const [nConcept, setNConcept] = useState('')
  const [nCat, setNCat] = useState('comida'); const [nPct, setNPct] = useState('50')
  const [nPaidBy, setNPaidBy] = useState<'me' | 'them'>('me')
  const [formError, setFormError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<SharedExpense | null>(null)

  const PERSON_COLORS = ['#EC4899','#3B82F6','#22C55E','#F97316','#8B5CF6']

  const addPerson = () => {
    const personName = newPersonName.trim()
    if (!personName) {
      setFormError('Ingresá el nombre de la persona.')
      return
    }
    if (people.some(person => person.name.toLocaleLowerCase('es') === personName.toLocaleLowerCase('es'))) {
      setFormError('Esa persona ya está agregada.')
      return
    }
    const p: SharedPerson = { id: uid(), name: personName, color: PERSON_COLORS[people.length % PERSON_COLORS.length] }
    setPeople([...people, p]); setSelectedPerson(p.id); setNewPersonName(''); setShowAddPerson(false)
    setFormError('')
  }
  const addExpense = () => {
    const amount = parseMonto(nAmount)
    const percentage = parseMonto(nPct)
    if (!selectedPerson) {
      setFormError('Elegí una persona para dividir el gasto.')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('El monto debe ser mayor a cero.')
      return
    }
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      setFormError('Tu porcentaje debe estar entre 0 y 100.')
      return
    }
    setSharedExpenses([...sharedExpenses, { id: uid(), amount, concept: nConcept.trim(), category: nCat, date: todayStr(), sharedPersonId: selectedPerson, myPercentage: percentage, settled: false, paidBy: nPaidBy }])
    setNAmount(''); setNConcept('')
    setFormError('')
  }
  const toggleSettled = (id: string) => setSharedExpenses(sharedExpenses.map(e => e.id === id ? { ...e, settled: !e.settled } : e))
  const confirmDelete = () => {
    if (pendingDelete) setSharedExpenses(sharedExpenses.filter(expense => expense.id !== pendingDelete.id))
    setPendingDelete(null)
  }

  const balances = people.map(p => {
    const exps = sharedExpenses.filter(e => e.sharedPersonId === p.id && !e.settled)
    const balance = exps.reduce((sum, e) => {
      const theirShare = e.amount * (1 - e.myPercentage / 100)
      const myShare   = e.amount * (e.myPercentage / 100)
      return e.paidBy === 'me' ? sum + theirShare : sum - myShare
    }, 0)
    return { ...p, balance, count: exps.length }
  })
  const personExps = sharedExpenses.filter(e => e.sharedPersonId === selectedPerson)
  const currentPerson = people.find(p => p.id === selectedPerson)

  return (
    <div className="flex-1 flex flex-col overflow-hidden screen-enter">
      <PageHeader title="Compartidos" onBack={onBack} />
      <Tabs tabs={['Gastos', 'Liquidación']} active={tab} onChange={setTab} />

      {tab === 'Gastos' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-5 mb-4 flex-shrink-0">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {people.map(p => (
                <button key={p.id} onClick={() => setSelectedPerson(p.id)}
                  className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium flex-shrink-0 transition-all duration-150 active:scale-[0.96]"
                  style={{
                    background: selectedPerson === p.id ? 'var(--fg)' : 'var(--card)',
                    color: selectedPerson === p.id ? 'var(--bg)' : 'var(--fg)',
                  }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                  {p.name}
                </button>
              ))}
              {showAddPerson ? (
                <div className="flex gap-1 flex-shrink-0">
                  <input value={newPersonName} onChange={e => { setNewPersonName(e.target.value); setFormError('') }} placeholder="Nombre"
                    className="rounded-full px-3 py-1.5 text-sm outline-none w-28"
                    style={{ background: 'var(--card)', color: 'var(--fg)', border: '1.5px solid #E8A33D' }} autoFocus />
                  <button onClick={addPerson} className="bg-[#E8A33D] rounded-full px-3 py-1.5 text-sm font-semibold transition-all active:scale-95"
                    style={{ color: '#2B2F36' }}>OK</button>
                </div>
              ) : (
                <button onClick={() => setShowAddPerson(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium flex-shrink-0 border border-dashed transition-all duration-150 active:scale-95"
                  style={{ background: 'var(--card)', color: 'var(--muted)', borderColor: 'var(--border)' }}>
                  + Persona
                </button>
              )}
            </div>
            {showAddPerson && formError && <p className="text-xs text-red-500 mt-2" role="alert">{formError}</p>}
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-8">
            {personExps.length > 0 && (
              <div className="rounded-2xl overflow-hidden mb-4" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
                {personExps.map((exp, i) => {
                  const cat = catInfo(exp.category, categories)
                  const myAmt = exp.amount * (exp.myPercentage / 100)
                  return (
                    <div key={exp.id} className={`px-4 py-3.5 ${exp.settled ? 'opacity-40' : ''}`}
                      style={{ borderBottom: i < personExps.length - 1 ? '1px solid var(--divider)' : 'none' }}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 flex-1 min-w-0">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5" style={{ background: cat.color }} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>{exp.concept || cat.label}</p>
                            <p className="text-xs" style={{ color: 'var(--muted)' }}>
                              {exp.paidBy === 'me' ? 'Pagué yo' : `Pagó ${currentPerson?.name}`} · {exp.myPercentage}% mío
                            </p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>{fmt(exp.amount)}</p>
                          <p className="text-xs" style={{ color: 'var(--muted)' }}>mi parte: {fmt(myAmt)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mt-2">
                        <button onClick={() => toggleSettled(exp.id)} className="text-xs font-semibold text-[#E8A33D] transition-opacity hover:opacity-75 active:scale-[0.97]">
                          {exp.settled ? 'Reabrir gasto' : 'Marcar como saldado'}
                        </button>
                        <button onClick={() => setPendingDelete(exp)}
                          className="text-xs font-semibold text-red-400 transition-opacity hover:opacity-75 active:scale-[0.97]"
                          aria-label={`Eliminar ${exp.concept || cat.label}`}>
                          Eliminar
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {currentPerson && (
              <div className="rounded-2xl p-4 flex flex-col gap-3 border border-dashed border-[#E8A33D]/40" style={{ background: 'var(--card)' }}>
                <p className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                  Nuevo gasto con {currentPerson.name}
                </p>
                <div className="flex gap-3">
                  <div className="flex-1"><Input label="Monto" value={nAmount} onChange={v => { setNAmount(v); setFormError('') }} type="money" placeholder="5.000" /></div>
                  <div className="w-20"><Input label="Mi %" value={nPct} onChange={v => { setNPct(v); setFormError('') }} type="int" placeholder="50" /></div>
                </div>
                <Input label="Concepto" value={nConcept} onChange={v => { setNConcept(v); setFormError('') }} placeholder="Cena" />
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>Categoría</p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {categories.map(category => (
                      <button key={category.id} onClick={() => setNCat(category.id)}
                        className="flex items-center gap-2 px-3 py-2 rounded-full text-xs font-semibold flex-shrink-0 transition-all active:scale-95"
                        style={{
                          background: nCat === category.id ? 'var(--fg)' : 'var(--subtle)',
                          color: nCat === category.id ? 'var(--bg)' : 'var(--fg)',
                        }}>
                        <span className="w-2 h-2 rounded-full" style={{ background: category.color }} />
                        {category.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>¿Quién pagó?</p>
                  <div className="flex gap-2">
                    {(['me', 'them'] as const).map(v => (
                      <button key={v} onClick={() => setNPaidBy(v)}
                        className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 active:scale-[0.97]"
                        style={{
                          background: nPaidBy === v ? 'var(--fg)' : 'var(--subtle)',
                          color: nPaidBy === v ? 'var(--bg)' : 'var(--fg)',
                        }}>
                        {v === 'me' ? 'Yo' : currentPerson.name}
                      </button>
                    ))}
                  </div>
                </div>
                {!showAddPerson && formError && <p className="text-xs text-red-500" role="alert">{formError}</p>}
                <Btn onClick={addExpense}>Guardar gasto</Btn>
              </div>
            )}
            {people.length === 0 && (
              <p className="text-sm text-center py-8" style={{ color: 'var(--muted)' }}>
                Agregá una persona para empezar a dividir gastos.
              </p>
            )}
          </div>
        </div>
      )}

      {tab === 'Liquidación' && (
        <div className="flex-1 overflow-y-auto px-5 pb-8">
          {balances.length === 0 && (
            <p className="text-sm text-center py-12" style={{ color: 'var(--muted)' }}>No hay gastos pendientes de liquidar.</p>
          )}
          {balances.map(b => (
            <div key={b.id} className="rounded-2xl p-5 mb-3 transition-shadow hover:shadow-md" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style={{ background: b.color }}>
                  {b.name.charAt(0)}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold" style={{ color: 'var(--fg)' }}>{b.name}</p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>{b.count} {b.count === 1 ? 'gasto pendiente' : 'gastos pendientes'}</p>
                </div>
              </div>
              {Math.abs(b.balance) < 0.5 ? (
                <div className="rounded-xl px-4 py-2.5 text-center" style={{ background: 'var(--subtle)' }}>
                  <p className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>Estamos al dia</p>
                </div>
              ) : (
                <div className={`rounded-xl px-4 py-3 ${b.balance > 0 ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                  <p className={`text-sm font-semibold ${b.balance > 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {b.balance > 0 ? `${b.name} te debe` : `Le debés a ${b.name}`}
                  </p>
                  <p className="text-2xl font-bold mt-0.5"
                    style={{ fontFamily: '"DM Serif Display", serif', color: b.balance > 0 ? '#15803d' : '#dc2626' }}>
                    {fmt(Math.abs(b.balance))}
                  </p>
                </div>
              )}
            </div>
          ))}
          {balances.length > 0 && (
            <div className="rounded-2xl p-5 mt-2" style={{ background: 'var(--fg)' }}>
              <p className="text-[12px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--bg)', opacity: 0.5 }}>Balance total</p>
              <p className="text-2xl font-bold" style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--bg)' }}>
                {fmt(Math.abs(balances.reduce((s, b) => s + b.balance, 0)))}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--bg)', opacity: 0.5 }}>
                {balances.reduce((s, b) => s + b.balance, 0) >= 0 ? 'te deben en total' : 'debés en total'}
              </p>
            </div>
          )}
        </div>
      )}
      {pendingDelete && (
        <ConfirmDialog
          title="¿Eliminar este gasto compartido?"
          body="El movimiento se quitará de la cuenta compartida y los saldos se recalcularán automáticamente."
          confirmLabel="Eliminar"
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}

/* ─── Reports screen ─────────────────────────────────────────────────────── */

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ value: number }> }) {
  if (!active || !payload?.length) return null
  return (
    <div className="px-3 py-1.5 rounded-xl text-xs font-bold shadow-lg" style={{ background: 'var(--fg)', color: 'var(--bg)' }}>
      {fmt(payload[0].value)}
    </div>
  )
}

function ReportsScreen({ expenses, incomes, shared, salary, fixedExpenses, debts, varEstimate, savingsGoal, payday, darkMode, onBack }: {
  expenses: Expense[]; incomes: Income[]; shared: SharedExpense[]; salary: number; fixedExpenses: FixedExpense[]; debts: Debt[]
  varEstimate: number; savingsGoal: number; payday: number; darkMode: boolean; onBack: () => void
}) {
  const [tab, setTab] = useState('Semana')
  const { categories } = useCategories()
  const budget = getBudgetSnapshot({ salary, fixedExpenses, debts, expenses, incomes, shared, varEstimate, savingsGoal, payday })
  // gastos que cuentan: los propios + mi parte de los compartidos
  const gastosConMiParte: Expense[] = [
    ...expenses,
    ...shared.map(x => ({ id: x.id, amount: x.amount * (x.myPercentage / 100), concept: x.concept, category: x.category, date: x.date })),
  ]

  const last7 = Array.from({ length: 7 }, (_, i) => dateStr(6 - i))
  const weekData = last7.map(date => ({
    day: shortDay(date),
    total: gastosConMiParte.filter(e => e.date === date).reduce((s, e) => s + e.amount, 0),
    isToday: date === todayStr()
  }))
  const weekTotal = weekData.reduce((s, d) => s + d.total, 0)
  const weekBudget = budget.dailyBudget * 7
  const weekMax = Math.max(...weekData.map(d => d.total), 1)

  const monthExpenses = gastosConMiParte.filter(e => e.date >= budget.startKey && e.date < budget.endKey)
  const monthTotal = monthExpenses.reduce((s, e) => s + e.amount, 0)
  const monthBudget = budget.totalBudget
  const avgDaily = monthTotal / budget.elapsedDays
  const { totalFixed, totalDebt } = budget

  const catBreakdown = categories.map(c => ({
    ...c,
    total: monthExpenses.filter(e => e.category === c.id).reduce((s, e) => s + e.amount, 0),
    pct: monthTotal > 0 ? Math.round((monthExpenses.filter(e => e.category === c.id).reduce((s, e) => s + e.amount, 0) / monthTotal) * 100) : 0,
  })).filter(c => c.total > 0).sort((a, b) => b.total - a.total)
  const catMax = catBreakdown[0]?.total || 1

  const barDefault = darkMode ? '#2A2E38' : '#EDE9E1'
  const barToday = darkMode ? '#EDE9E0' : '#2B2F36'

  return (
    <div className="flex-1 flex flex-col overflow-hidden screen-enter">
      <PageHeader title="Reportes" onBack={onBack} />
      <Tabs tabs={['Semana', 'Ciclo']} active={tab} onChange={setTab} />

      {tab === 'Semana' && (
        <div className="flex-1 overflow-y-auto px-5 pb-8">
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="rounded-2xl px-4 py-4 transition-shadow hover:shadow-md" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
              <p className="text-[12px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--muted)' }}>Gastado</p>
              <p className="text-xl font-bold" style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--fg)' }}>{fmt(weekTotal)}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>esta semana</p>
            </div>
            <div className="rounded-2xl px-4 py-4 transition-shadow hover:shadow-md" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
              <p className="text-[12px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--muted)' }}>Presupuesto</p>
              <p className="text-xl font-bold" style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--fg)' }}>{fmt(weekBudget)}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>7 días</p>
            </div>
          </div>

          <div className="rounded-2xl px-4 pt-5 pb-4 mb-5" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
            <p className="text-[12px] font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--muted)' }}>Últimos 7 días</p>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={weekData} barCategoryGap="20%">
                <XAxis dataKey="day" axisLine={false} tickLine={false}
                  tick={{ fontSize: 11, fill: 'var(--muted)', fontFamily: 'DM Sans' }} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                <Bar dataKey="total" radius={[6, 6, 2, 2]}>
                  {weekData.map((entry, i) => (
                    <Cell key={i} fill={entry.isToday ? barToday : entry.total === weekMax && entry.total > 0 ? '#E8A33D' : barDefault} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-4 mt-3 pt-3" style={{ borderTop: '1px solid var(--divider)' }}>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-[#E8A33D]" />
                <span className="text-xs" style={{ color: 'var(--muted)' }}>Mayor gasto</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: barToday }} />
                <span className="text-xs" style={{ color: 'var(--muted)' }}>Hoy</span>
              </div>
            </div>
          </div>

          <p className="text-[12px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>Por categoría</p>
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
            {(() => {
              const weekCats = categories.map(c => ({
                ...c, total: gastosConMiParte.filter(e => last7.includes(e.date) && e.category === c.id).reduce((s, e) => s + e.amount, 0)
              })).filter(c => c.total > 0).sort((a, b) => b.total - a.total)
              const wMax = weekCats[0]?.total || 1
              return weekCats.length === 0
                ? <p className="text-sm text-center py-6" style={{ color: 'var(--muted)' }}>Sin gastos esta semana.</p>
                : weekCats.map((c, i) => (
                  <div key={c.id} className="px-4 py-3.5"
                    style={{ borderBottom: i < weekCats.length - 1 ? '1px solid var(--divider)' : 'none' }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                        <span className="text-sm font-medium" style={{ color: 'var(--fg)' }}>{c.label}</span>
                      </div>
                      <span className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>{fmt(c.total)}</span>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--subtle)' }}>
                      <div className="h-full rounded-full" style={{ width: `${(c.total / wMax) * 100}%`, background: c.color, opacity: 0.7 }} />
                    </div>
                  </div>
                ))
            })()}
          </div>
        </div>
      )}

      {tab === 'Ciclo' && (
        <div className="flex-1 overflow-y-auto px-5 pb-8">
          <div className="rounded-2xl px-5 py-5 mb-4" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
            <p className="text-[12px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--muted)' }}>Gastado en este ciclo</p>
            <p className="text-4xl font-bold mb-1" style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--fg)' }}>
              {fmt(monthTotal)}
            </p>
            <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>de {fmt(monthBudget)} presupuestados</p>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--subtle)' }}>
              <div className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(100, monthBudget > 0 ? (monthTotal / monthBudget) * 100 : 0)}%`,
                  background: monthTotal > monthBudget ? '#EF4444' : monthTotal > monthBudget * 0.8 ? '#F97316' : '#E8A33D'
                }} />
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
              {budget.remainingDays} {budget.remainingDays === 1 ? 'día restante' : 'días restantes'} hasta el próximo cobro
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="rounded-2xl px-4 py-4 transition-shadow hover:shadow-md" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
              <p className="text-[12px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--muted)' }}>Promedio diario</p>
              <p className="text-xl font-bold" style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--fg)' }}>{fmt(avgDaily)}</p>
            </div>
            <div className="rounded-2xl px-4 py-4 transition-shadow hover:shadow-md" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
              <p className="text-[12px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--muted)' }}>Proyectado</p>
              <p className="text-xl font-bold" style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--fg)' }}>{fmt(avgDaily * budget.totalDays)}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>al ritmo actual</p>
            </div>
          </div>

          <p className="text-[12px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>Por categoría</p>
          <div className="rounded-2xl overflow-hidden mb-5" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
            {catBreakdown.length === 0
              ? <p className="text-sm text-center py-6" style={{ color: 'var(--muted)' }}>Sin gastos este mes.</p>
              : catBreakdown.map((c, i) => (
                <div key={c.id} className="px-4 py-4"
                  style={{ borderBottom: i < catBreakdown.length - 1 ? '1px solid var(--divider)' : 'none' }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                      <span className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>{c.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>{c.pct}%</span>
                      <span className="text-sm font-bold" style={{ color: 'var(--fg)' }}>{fmt(c.total)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--subtle)' }}>
                    <div className="h-full rounded-full" style={{ width: `${(c.total / catMax) * 100}%`, background: c.color }} />
                  </div>
                </div>
              ))
            }
          </div>

          <p className="text-[12px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>Estructura del sueldo</p>
          <div className="rounded-2xl p-5" style={{ background: 'var(--fg)' }}>
            {[
              { label: 'Sueldo',          amount: salary,              color: 'transparent' },
              ...(budget.extraIncome > 0 ? [{ label: 'Ingresos extra', amount: budget.extraIncome, color: '#16A34A' }] : []),
              { label: 'Gastos fijos',    amount: -totalFixed,         color: '#E8A33D' },
              { label: 'Deudas',          amount: -totalDebt,          color: '#EF4444' },
              { label: 'Ahorro meta',     amount: -savingsGoal,        color: '#22C55E' },
              { label: 'Día a día',       amount: -Math.max(0, budget.totalBudget), color: '#3B82F6' },
              { label: budget.libre >= 0 ? 'Libre (sin asignar)' : 'Faltante', amount: budget.libre, color: '#9B9EA3' },
            ].filter(item => item.label === 'Sueldo' || Math.abs(item.amount) >= 1).map(item => (
              <div key={item.label} className="flex items-center justify-between py-2.5"
                style={{ borderBottom: '1px solid rgba(128,128,128,0.15)' }}>
                <div className="flex items-center gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: item.color }} />
                  <span className="text-sm" style={{ color: 'var(--bg)', opacity: 0.7 }}>{item.label}</span>
                </div>
                <span className="text-sm font-bold" style={{ color: 'var(--bg)' }}>{item.amount <= -1 ? '− ' + fmt(-item.amount) : fmt(Math.abs(item.amount))}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Import screen ──────────────────────────────────────────────────────── */

type ImportStep = 'upload' | 'review' | 'done'

function ImportScreen({ expenses, incomes, onImport, onBack }: {
  expenses: Expense[]; incomes: Income[]; onImport: (gastos: Expense[], ingresos: Income[]) => void; onBack: () => void
}) {
  const existentes = [...expenses, ...incomes]
  const [importedIncomes, setImportedIncomes] = useState(0)
  const { categories } = useCategories()
  const [step, setStep]             = useState<ImportStep>('upload')
  const [txns, setTxns]             = useState<ParsedTransaction[]>([])
  const [filter, setFilter]         = useState('Débitos')
  const [editingCat, setEditingCat] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [importedCount, setImportedCount] = useState(0)
  const [parseError, setParseError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const processFile = (file: File) => {
    setParseError(null)
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const ext = file.name.toLowerCase().split('.').pop()
      let parsed: ParsedTransaction[] = []
      if (ext === 'ofx' || ext === 'qfx') parsed = parseOFX(text, existentes)
      else parsed = parseCSV(text, existentes)
      if (parsed.length === 0) { setParseError('No se encontraron movimientos en el archivo. Probá exportarlo como CSV desde el home banking.'); return }
      // los posibles duplicados arrancan sin tildar
      parsed = parsed.map(t => (t.isDuplicate ? { ...t, selected: false } : t))
      setTxns(parsed); setStep('review')
    }
    reader.onerror = () => setParseError('Error al leer el archivo.')
    reader.readAsText(file, 'UTF-8')
  }

  const toggle = (id: string) => setTxns(p => p.map(t => t.id === id ? { ...t, selected: !t.selected } : t))
  const toggleAll = () => {
    const visible = filtered()
    const allSel = visible.every(t => t.selected)
    const ids = new Set(visible.map(t => t.id))
    setTxns(p => p.map(t => ids.has(t.id) ? { ...t, selected: !allSel } : t))
  }
  const setCat = (id: string, cat: string) => { setTxns(p => p.map(t => t.id === id ? { ...t, category: cat } : t)); setEditingCat(null) }
  const filtered = () => {
    if (filter === 'Débitos') return txns.filter(t => t.isDebit)
    if (filter === 'Créditos') return txns.filter(t => !t.isDebit)
    return txns
  }
  const handleImport = () => {
    const gastos: Expense[] = txns.filter(t => t.selected && t.isDebit)
      .map(t => ({ id: uid(), amount: t.amount, concept: t.description, category: t.category, date: t.date }))
    const ingresos: Income[] = txns.filter(t => t.selected && !t.isDebit)
      .map(t => ({ id: uid(), amount: t.amount, concept: t.description, date: t.date }))
    onImport(gastos, ingresos); setImportedCount(gastos.length); setImportedIncomes(ingresos.length); setStep('done')
  }
  const selectedCount = txns.filter(t => t.selected).length

  return (
    <div className="flex-1 flex flex-col overflow-hidden screen-enter">
      <PageHeader title="Importar extracto" onBack={onBack} />

      {step === 'upload' && (
        <div className="flex-1 overflow-y-auto px-5 pb-8">
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) processFile(f) }}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-3xl px-6 py-10 text-center cursor-pointer transition-all duration-200 mb-5 ${isDragging ? 'border-[#E8A33D]' : 'hover:border-[#E8A33D]/60'}`}
            style={{
              borderColor: isDragging ? '#E8A33D' : 'var(--border)',
              background: isDragging ? 'rgba(232,163,61,0.08)' : 'var(--card)',
            }}>
            <input ref={fileRef} type="file" accept=".csv,.ofx,.qfx,.txt" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f) }} />
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--subtle)' }}>
              <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                <path d="M13 4V16M13 4L9 8M13 4L17 8" stroke="var(--muted)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M4 20H22" stroke="var(--muted)" strokeWidth="1.75" strokeLinecap="round"/>
                <rect x="4" y="12" width="4" height="8" rx="1" fill="#E8A33D" opacity="0.3"/>
              </svg>
            </div>
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--fg)' }}>Arrastrá o seleccioná un archivo</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>Formatos: CSV, OFX, QFX</p>
          </div>

          {parseError && (
            <div className="bg-red-500/10 rounded-2xl px-4 py-3 mb-4">
              <p className="text-sm text-red-500 font-medium">{parseError}</p>
            </div>
          )}

          <p className="text-[12px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>Cómo exportar de tu banco</p>
          <div className="rounded-2xl overflow-hidden mb-5" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
            {[
              { bank: 'Galicia',       hint: 'Banca Online → Mis movimientos → Exportar CSV' },
              { bank: 'Santander',     hint: 'App → Cuenta → Movimientos → Descargar' },
              { bank: 'BBVA',          hint: 'Online Banking → Cuentas → Descargar movimientos' },
              { bank: 'Brubank',       hint: 'App → Cuenta → Movimientos → Compartir CSV' },
              { bank: 'Mercado Pago',  hint: 'Actividad → Filtrar → Descargar historial' },
            ].map((b, i) => (
              <div key={b.bank} className="px-4 py-3.5"
                style={{ borderBottom: i < 4 ? '1px solid var(--divider)' : 'none' }}>
                <p className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>{b.bank}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{b.hint}</p>
              </div>
            ))}
          </div>

          <div className="bg-[#E8A33D]/10 rounded-2xl p-4 mb-4">
            <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
              Los débitos entran como gastos. Los créditos (plata que entra) los podés tildar para sumarlos como ingresos extra;
              no tildes el sueldo, porque ya está en tu perfil.
            </p>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-5 mb-3 flex-shrink-0">
            <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
              {txns.length} movimientos · {selectedCount} elegidos para importar
            </p>
            <Tabs tabs={['Débitos', 'Créditos', 'Todos']} active={filter} onChange={setFilter} />
          </div>
          <div className="px-5 mb-2 flex items-center justify-between flex-shrink-0">
            <button onClick={toggleAll} className="text-xs font-semibold text-[#E8A33D] transition-opacity hover:opacity-75 active:scale-[0.97]">
              {filtered().every(t => t.selected) ? 'Deseleccionar todo' : 'Seleccionar todo'}
            </button>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>{`${filtered().filter(t => t.selected).length} / ${filtered().length}`}</span>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-4">
            {filtered().length === 0 && (
              <p className="text-sm text-center py-8" style={{ color: 'var(--muted)' }}>No hay movimientos de este tipo.</p>
            )}
            <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-sm)' }}>
              {filtered().map((t, i) => {
                const cat = catInfo(t.category, categories)
                const isLast = i === filtered().length - 1
                return (
                  <div key={t.id} className="relative" style={{ borderBottom: !isLast ? '1px solid var(--divider)' : 'none' }}>
                    <div className={`flex items-start gap-3 px-4 py-3.5 transition-colors ${t.selected ? '' : 'opacity-50'}`}>
                      <button onClick={() => toggle(t.id)} aria-label={`${t.selected ? 'Quitar' : 'Elegir'} ${t.description}`} aria-pressed={t.selected}
                        className="w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all duration-150 active:scale-90"
                        style={{ background: t.selected ? (t.isDebit ? 'var(--fg)' : '#16A34A') : 'transparent', borderColor: t.selected ? (t.isDebit ? 'var(--fg)' : '#16A34A') : 'var(--border)' }}>
                        {t.selected && (
                          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                            <path d="M1 4L3.5 6.5L9 1" stroke={t.isDebit ? 'var(--bg)' : '#FFFFFF'} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium truncate leading-snug" style={{ color: 'var(--fg)' }}>{t.description}</p>
                          <span className={`text-sm font-bold flex-shrink-0 ${t.isDebit ? '' : 'text-green-600'}`}
                            style={t.isDebit ? { color: 'var(--fg)' } : undefined}>
                            {t.isDebit ? '-' : '+'}{fmt(t.amount)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-xs" style={{ color: 'var(--muted)' }}>{fmtDate(t.date)}</p>
                          {t.isDuplicate && (
                            <span className="text-[10px] font-semibold text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded-full">posible duplicado</span>
                          )}
                          <button onClick={() => t.isDebit && setEditingCat(editingCat === t.id ? null : t.id)} disabled={!t.isDebit}
                            className="flex items-center gap-1 px-2 py-0.5 rounded-full transition-all active:scale-95"
                            style={{ background: 'var(--subtle)' }}>
                            <div className="w-1.5 h-1.5 rounded-full" style={{ background: cat.color }} />
                            <span className="text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>{t.isDebit ? cat.label : 'Ingreso extra'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                    {editingCat === t.id && (
                      <div className="px-4 pb-3 grid grid-cols-4 gap-1.5">
                        {categories.map(c => (
                          <button key={c.id} onClick={() => setCat(t.id, c.id)}
                            className="flex flex-col items-center gap-1 px-1 py-2 rounded-xl transition-all duration-150 active:scale-[0.94]"
                            style={{
                              background: t.category === c.id ? 'var(--fg)' : 'var(--subtle)',
                            }}>
                            <div className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                            <span className="text-[9px] font-semibold leading-tight text-center"
                              style={{ color: t.category === c.id ? 'var(--bg)' : 'var(--muted)' }}>{c.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="px-5 pb-8 pt-3 flex gap-3 flex-shrink-0">
            <Btn variant="ghost" onClick={() => { setStep('upload'); setTxns([]); setEditingCat(null) }} className="flex-none w-auto px-5">Atrás</Btn>
            <Btn onClick={handleImport} className={selectedCount === 0 ? 'opacity-40 pointer-events-none' : ''}>
              Importar {selectedCount > 0 ? `${selectedCount} movimiento${selectedCount !== 1 ? 's' : ''}` : ''}
            </Btn>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center pb-16 screen-enter">
          <div className="w-20 h-20 rounded-full bg-[#E8A33D]/15 flex items-center justify-center mb-6">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <path d="M7 18L14 25L29 10" stroke="#E8A33D" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h2 className="text-2xl font-bold mb-2" style={{ fontFamily: '"DM Serif Display", serif', fontStyle: 'italic', color: 'var(--fg)' }}>¡Listo!</h2>
          <p className="text-sm mb-1" style={{ color: 'var(--muted)' }}>
            Se importaron <span className="font-bold" style={{ color: 'var(--fg)' }}>{importedCount}</span> {importedCount === 1 ? 'gasto' : 'gastos'}
            {importedIncomes > 0 && <> y <span className="font-bold" style={{ color: 'var(--fg)' }}>{importedIncomes}</span> {importedIncomes === 1 ? 'ingreso' : 'ingresos'}</>}.
          </p>
          <p className="text-xs mb-10" style={{ color: 'var(--muted)' }}>Ya están disponibles en el historial y en los reportes.</p>
          <Btn onClick={onBack}>Volver al inicio</Btn>
        </div>
      )}
    </div>
  )
}

/* ─── Notifications screen ───────────────────────────────────────────────── */

const NOTIF_ICONS: Record<string, React.ReactNode> = {
  due:     <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="3" stroke="currentColor" strokeWidth="1.5"/><path d="M8 5V8L10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  budget:  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/><path d="M8 5V8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/><circle cx="8" cy="11" r="0.75" fill="currentColor"/></svg>,
  savings: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 10C3 7.2 5.2 5 8 5C10.8 5 13 7.2 13 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M5.5 13C5.5 13 6 11.5 8 11.5C10 11.5 10.5 13 10.5 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M8 2V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  debt:    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8H13M10 5L13 8L10 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  weekly:  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 12L5 7.5L8 10L11 5L14 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  tip:     <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2C5.8 2 4 3.8 4 6C4 7.5 4.8 8.8 6 9.5V11H10V9.5C11.2 8.8 12 7.5 12 6C12 3.8 10.2 2 8 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M6 13H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
}

const PRIORITY_STYLE_LIGHT = {
  high:   { bg: '#FEF2F2', border: '#EF4444', icon: '#EF4444' },
  medium: { bg: '#FFFBEB', border: '#E8A33D', icon: '#E8A33D' },
  info:   { bg: '#FFFFFF', border: '#E0DDD6', icon: '#9B9EA3' },
}
const PRIORITY_STYLE_DARK = {
  high:   { bg: 'rgba(239,68,68,0.10)',    border: '#EF4444', icon: '#EF4444' },
  medium: { bg: 'rgba(232,163,61,0.10)',   border: '#E8A33D', icon: '#E8A33D' },
  info:   { bg: 'var(--card)',              border: 'var(--border)', icon: 'var(--muted)' },
}

function NotificationsScreen({ notifications, readIds, darkMode, onMarkRead, onMarkAllRead, onNavigate, onBack }: {
  notifications: AppNotification[]
  readIds: Set<string>; darkMode: boolean
  onMarkRead: (id: string) => void; onMarkAllRead: () => void
  onNavigate: (s: Screen) => void; onBack: () => void
}) {
  const unread = notifications.filter(n => !readIds.has(n.id)).length
  const PRIORITY_STYLE = darkMode ? PRIORITY_STYLE_DARK : PRIORITY_STYLE_LIGHT

  return (
    <div className="flex-1 flex flex-col overflow-hidden screen-enter">
      <PageHeader title="Notificaciones" onBack={onBack}
        right={
          unread > 0
            ? <button onClick={onMarkAllRead} className="text-xs font-semibold text-[#E8A33D] transition-opacity hover:opacity-75 active:scale-[0.97]">Marcar todo leído</button>
            : null
        }
      />
      {notifications.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center pb-20 px-8 text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-5" style={{ background: 'var(--subtle)', color: 'var(--placeholder)' }}>
            <IconBell />
          </div>
          <p className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>Todo en orden</p>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>No hay alertas por ahora.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-5 pb-8">
          {unread > 0 && (
            <p className="text-[12px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>
              {unread} sin leer
            </p>
          )}
          <div className="flex flex-col gap-2.5">
            {notifications.map(n => {
              const isRead = readIds.has(n.id)
              const style = PRIORITY_STYLE[n.priority]
              const readBg = darkMode ? 'var(--card)' : '#FFFFFF'
              const readBorder = darkMode ? 'var(--border)' : '#E0DDD6'
              return (
                <div key={n.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${isRead ? 'Notificación leída' : 'Notificación sin leer'}: ${n.title}`}
                  className="rounded-2xl overflow-hidden transition-all duration-150 active:scale-[0.99] cursor-pointer"
                  style={{
                    background: isRead ? readBg : style.bg,
                    borderLeft: `3px solid ${isRead ? readBorder : style.border}`,
                    boxShadow: 'var(--shadow-sm)',
                  }}
                  onClick={() => onMarkRead(n.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onMarkRead(n.id)
                    }
                  }}>
                  <div className="px-4 py-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{
                          background: isRead ? 'var(--subtle)' : style.bg,
                          color: isRead ? 'var(--muted)' : style.icon,
                          border: `1px solid ${isRead ? 'var(--border)' : style.border}20`
                        }}>
                        {NOTIF_ICONS[n.type]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm leading-snug"
                            style={{ fontWeight: isRead ? 500 : 700, color: isRead ? 'var(--muted)' : 'var(--fg)' }}>
                            {n.title}
                          </p>
                          {!isRead && <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: style.border }} />}
                        </div>
                        <p className="text-xs mt-1 leading-relaxed" style={{ color: isRead ? 'var(--placeholder)' : 'var(--muted)' }}>
                          {n.body}
                        </p>
                        {n.action && !isRead && (
                          <button
                            onClick={e => { e.stopPropagation(); onMarkRead(n.id); onNavigate(n.action!.screen) }}
                            className="mt-2.5 text-xs font-bold px-3 py-1.5 rounded-full transition-all duration-150 active:scale-95"
                            style={{ background: style.border + '20', color: style.icon }}>
                            {n.action.label} →
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {unread === 0 && notifications.length > 0 && (
            <p className="text-xs text-center mt-6" style={{ color: 'var(--placeholder)' }}>Todo leído</p>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── Pantallas de espera ────────────────────────────────────────────────── */

function Splash({ texto }: { texto?: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8 text-center fade-in">
      <div className="notif-pulse"><LogoSaldo size={56} /></div>
      {texto && <p className="text-sm" style={{ color: 'var(--muted)' }}>{texto}</p>}
    </div>
  )
}

function ErrorCarga({ onRetry, onLogout }: { onRetry: () => void; onLogout: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-4">
      <LogoSaldo size={56} />
      <p className="text-base font-semibold" style={{ color: 'var(--fg)' }}>No pudimos traer tus datos</p>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>Revisá tu conexión a internet y probá de nuevo.</p>
      <div className="w-full max-w-xs flex flex-col gap-3 mt-2">
        <Btn onClick={onRetry}>Reintentar</Btn>
        <Btn variant="ghost" onClick={onLogout}>Cerrar sesión</Btn>
      </div>
    </div>
  )
}

/* ─── App ────────────────────────────────────────────────────────────────── */

/** Lee un error que Supabase deja en la dirección al volver de un link vencido */
function errorDeLink(): string {
  try {
    const p = new URLSearchParams(window.location.hash.replace(/^#/, '') || window.location.search)
    const code = p.get('error_code') || p.get('error')
    if (!code) return ''
    history.replaceState(null, '', window.location.pathname)
    if (code.includes('expired')) return 'El link venció o ya se usó. Pedí uno nuevo.'
    return 'El link no es válido. Pedí uno nuevo.'
  } catch { return '' }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authListo, setAuthListo] = useState(false)
  const [recuperando, setRecuperando] = useState(false)
  const [authModo, setAuthModo] = useState<AuthModo>('login')
  const [avisoLink] = useState(errorDeLink)
  const [darkMode, setDarkMode] = usePersistentState(
    'saldo:darkMode',
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthListo(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      setAuthListo(true)
      if (event === 'PASSWORD_RECOVERY') setRecuperando(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // tema en toda la página (también detrás de las zonas seguras del celular)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', darkMode ? '#14161B' : '#F4F1EC')
  }, [darkMode])

  const user = session?.user ?? null
  const nombreInicial = String(user?.user_metadata?.nombre ?? '')
  const nube = useNube(user?.id ?? null, nombreInicial)
  const { datos, setPerfil, setLista } = nube
  const { perfil, expenses, incomes, fixedExpenses, debts, children, people, shared } = datos

  const [screen, setScreen]         = useState<Screen>('home')
  const [onbStep, setOnbStep]       = useState(1)
  const [showModal,    setShowModal]     = useState(false)
  const [editingMov,   setEditingMov]    = useState<Mov | null>(null)
  const [showMenu,     setShowMenu]      = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Mov | null>(null)

  // Botón "atrás" del celular: vuelve al inicio en vez de salir de la app
  useEffect(() => {
    const onPop = () => { setShowMenu(false); setShowModal(false); setEditingMov(null); setScreen('home') }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const goTo = (s: Screen) => {
    setShowMenu(false)
    if (s !== 'home' && screen === 'home') history.pushState({ saldo: s }, '')
    else if (s !== 'home') history.replaceState({ saldo: s }, '')
    setScreen(s)
  }
  const volver = () => {
    if ((history.state as { saldo?: string } | null)?.saldo) history.back()
    else setScreen('home')
  }

  const budget = getBudgetSnapshot({
    salary: perfil.salary, fixedExpenses, debts, expenses, incomes, shared,
    varEstimate: perfil.varEstimate, savingsGoal: perfil.savingsGoal, payday: perfil.payday,
  })
  const categories = [...CATS, ...datos.categories]
  const addCategory = (category: Category) => {
    setLista('categories', current => current.some(c => c.id === category.id) ? current : [...current, category])
  }

  const movs: Mov[] = [
    ...expenses.map(item => ({ kind: 'gasto' as const, item })),
    ...incomes.map(item => ({ kind: 'ingreso' as const, item })),
  ]
  const movsHoy = movs.filter(m => m.item.date === todayStr())

  const saveMov = (kind: Mov['kind'], d: { amount: number; concept: string; category: string; date: string }) => {
    if (editingMov) {
      if (editingMov.kind === 'gasto') {
        setLista('expenses', cur => cur.map(e => e.id === editingMov.item.id ? { ...e, amount: d.amount, concept: d.concept, category: d.category, date: d.date } : e))
      } else {
        setLista('incomes', cur => cur.map(i => i.id === editingMov.item.id ? { ...i, amount: d.amount, concept: d.concept, date: d.date } : i))
      }
    } else if (kind === 'gasto') {
      setLista('expenses', cur => [...cur, { id: uid(), amount: d.amount, concept: d.concept, category: d.category, date: d.date }])
    } else {
      setLista('incomes', cur => [...cur, { id: uid(), amount: d.amount, concept: d.concept, date: d.date }])
    }
    setEditingMov(null)
    setShowModal(false)
  }
  const openNew = () => { setEditingMov(null); setShowModal(true) }
  const openEdit = (mov: Mov) => { setEditingMov(mov); setShowModal(true) }
  const closeModal = () => { setEditingMov(null); setShowModal(false) }
  const confirmDelete = () => {
    if (pendingDelete?.kind === 'gasto') setLista('expenses', cur => cur.filter(e => e.id !== pendingDelete.item.id))
    if (pendingDelete?.kind === 'ingreso') setLista('incomes', cur => cur.filter(i => i.id !== pendingDelete.item.id))
    setPendingDelete(null)
  }
  const importMovs = (gastos: Expense[], ingresos: Income[]) => {
    if (gastos.length) setLista('expenses', cur => [...cur, ...gastos])
    if (ingresos.length) setLista('incomes', cur => [...cur, ...ingresos])
  }

  const notifications = generateNotifications({
    fixedExpenses, debts, expenses, incomes, shared,
    salary: perfil.salary, varEstimate: perfil.varEstimate, savingsGoal: perfil.savingsGoal, payday: perfil.payday,
  })
  const readIds = new Set(perfil.readIds)
  const unreadCount = notifications.filter(n => !readIds.has(n.id)).length
  const markRead = (id: string) => { if (!readIds.has(id)) setPerfil(p => ({ readIds: [...p.readIds, id] })) }
  const markAllRead = () => setPerfil(p => ({ readIds: [...new Set([...p.readIds, ...notifications.map(n => n.id)])] }))

  const toggleDark = () => setDarkMode(v => !v)

  const cerrarSesion = async () => {
    const todoSubido = await nube.subirAntesDeSalir()
    if (!todoSubido && !window.confirm('Hay cambios que todavía no se guardaron en la nube porque no hay conexión. Si cerrás sesión ahora, se pierden. ¿Cerrar igual?')) return
    if (user) borrarLocal(user.id)
    setShowMenu(false); setShowModal(false); setEditingMov(null); setScreen('home'); setOnbStep(1); setAuthModo('login')
    await supabase.auth.signOut()
  }

  const borrarCuenta = async (): Promise<string | null> => {
    const { error } = await supabase.rpc('saldo_borrar_cuenta')
    if (error) return 'No se pudo eliminar la cuenta. Revisá tu conexión y probá de nuevo.'
    if (user) borrarLocal(user.id)
    setScreen('home'); setOnbStep(1); setAuthModo('login')
    await supabase.auth.signOut()
    return null
  }

  const terminarOnboarding = () => { setPerfil({ onboardingDone: true }); setScreen('home') }

  const sync = !nube.online
    ? (nube.pendientes > 0 ? 'Sin conexión · se guarda al volver' : 'Sin conexión')
    : nube.pendientes > 0 ? 'Guardando…' : null

  let contenido: React.ReactNode
  if (!authListo) contenido = <Splash />
  else if (recuperando && user) contenido = <NewPasswordScreen onDone={() => { setRecuperando(false); history.replaceState(null, '', window.location.pathname) }} />
  else if (!user) contenido = <LoginScreen modo={authModo} setModo={setAuthModo} avisoInicial={avisoLink} />
  else if (nube.estado === 'cargando') contenido = <Splash texto="Cargando tus datos…" />
  else if (nube.estado === 'error') contenido = <ErrorCarga onRetry={() => void nube.recargar()} onLogout={() => void cerrarSesion()} />
  else if (!perfil.onboardingDone) {
    contenido = (
      <OnboardingScreen
        step={onbStep} setStep={setOnbStep}
        name={perfil.name} setName={v => setPerfil({ name: v })}
        salary={perfil.salary} setSalary={v => setPerfil({ salary: v })}
        payday={perfil.payday} setPayday={v => setPerfil({ payday: v })}
        varEstimate={perfil.varEstimate} setVarEstimate={v => setPerfil({ varEstimate: v })}
        fixedExpenses={fixedExpenses} setFixedExpenses={v => setLista('fixedExpenses', v)}
        debts={debts} setDebts={v => setLista('debts', v)}
        marital={perfil.marital} setMarital={v => setPerfil({ marital: v })}
        children={children} setChildren={v => setLista('children', v)}
        savingsGoal={perfil.savingsGoal} setSavingsGoal={v => setPerfil({ savingsGoal: v })}
        onFinish={terminarOnboarding} />
    )
  } else {
    contenido = (
      <>
        {screen === 'home' && (
          <HomeScreen name={perfil.name} availableToday={budget.availableToday} todaySpent={budget.todaySpent} dailyBudget={budget.dailyBudget}
            remainingDays={budget.remainingDays} movs={movsHoy} unreadCount={unreadCount}
            darkMode={darkMode} sync={sync} onToggleDark={toggleDark}
            onAddExpense={openNew} onOpenMenu={() => setShowMenu(true)}
            onOpenNotifications={() => goTo('notifications')} onDelete={setPendingDelete} onEdit={openEdit} />
        )}
        {screen === 'history' && <HistoryScreen movs={movs} onBack={volver} onDelete={setPendingDelete} onEdit={openEdit} />}
        {screen === 'fixed' && (
          <FixedScreen fixedExpenses={fixedExpenses} setFixedExpenses={v => setLista('fixedExpenses', v)}
            debts={debts} setDebts={v => setLista('debts', v)} cycleKey={budget.startKey} onBack={volver} />
        )}
        {screen === 'profile' && (
          <ProfileScreen perfil={perfil} setPerfil={setPerfil} email={user.email ?? ''}
            darkMode={darkMode} onToggleDark={toggleDark} onDeleteAccount={borrarCuenta} onBack={volver} />
        )}
        {screen === 'children' && <ChildrenScreen children={children} setChildren={v => setLista('children', v)} onBack={volver} />}
        {screen === 'shared' && (
          <SharedScreen people={people} setPeople={v => setLista('people', v)}
            sharedExpenses={shared} setSharedExpenses={v => setLista('shared', v)} onBack={volver} />
        )}
        {screen === 'reports' && (
          <ReportsScreen expenses={expenses} incomes={incomes} shared={shared} salary={perfil.salary} fixedExpenses={fixedExpenses}
            debts={debts} varEstimate={perfil.varEstimate} savingsGoal={perfil.savingsGoal} payday={perfil.payday}
            darkMode={darkMode} onBack={volver} />
        )}
        {screen === 'import' && <ImportScreen expenses={expenses} incomes={incomes} onImport={importMovs} onBack={volver} />}
        {screen === 'notifications' && (
          <NotificationsScreen
            notifications={notifications} readIds={readIds} darkMode={darkMode}
            onMarkRead={markRead} onMarkAllRead={markAllRead}
            onNavigate={goTo} onBack={volver} />
        )}

        {showModal && <ExpenseModal mov={editingMov} onSave={saveMov} onClose={closeModal} />}
        {showMenu && <MenuDrawer name={perfil.name} email={user.email ?? ''} darkMode={darkMode} onToggleDark={toggleDark} onNavigate={goTo} onClose={() => setShowMenu(false)} onLogout={() => void cerrarSesion()} />}
        {pendingDelete && (
          <ConfirmDialog
            title={pendingDelete.kind === 'gasto' ? '¿Eliminar este gasto?' : '¿Eliminar este ingreso?'}
            body="Se quitará del historial y volverá a calcularse tu disponible de hoy. Esta acción no se puede deshacer."
            confirmLabel="Eliminar"
            onConfirm={confirmDelete}
            onClose={() => setPendingDelete(null)}
          />
        )}
      </>
    )
  }

  return (
    <CategoryContext.Provider value={{ categories, addCategory }}>
      <div className={`app-shell size-full overflow-hidden flex flex-col relative transition-colors duration-300 ${darkMode ? 'dark' : ''}`}
        style={{ background: 'var(--bg)' }}>
        {contenido}
      </div>
    </CategoryContext.Provider>
  )
}
