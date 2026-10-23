import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_KEY, APP_URL } from './config'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // implícito: los links de confirmar cuenta y recuperar clave funcionan aunque se abran en otro dispositivo
    flowType: 'implicit',
    storageKey: 'saldo-auth',
  },
})

/** Dirección a la que vuelven los links de los mails (confirmar cuenta, recuperar clave) */
export const redirectUrl = () => {
  if (typeof window === 'undefined') return APP_URL
  const { origin, pathname } = window.location
  return origin + pathname.replace(/index\.html$/, '')
}

/** Traduce los errores de Supabase Auth a mensajes claros */
export function errorAuth(e: unknown): string {
  const msg = String((e as { message?: string })?.message ?? e ?? '').toLowerCase()
  if (msg.includes('invalid login credentials')) return 'Email o contraseña incorrectos.'
  if (msg.includes('email not confirmed')) return 'Todavía no confirmaste tu email. Revisá tu casilla (y el correo no deseado).'
  if (msg.includes('already registered') || msg.includes('already been registered')) return 'Ya existe una cuenta con ese email. Probá ingresar.'
  if (msg.includes('rate limit') || msg.includes('too many') || msg.includes('security purposes')) return 'Demasiados intentos. Esperá unos minutos y probá de nuevo.'
  if (msg.includes('password should be') || msg.includes('weak')) return 'La contraseña es muy débil: usá al menos 8 caracteres, con letras y números.'
  if (msg.includes('failed to fetch') || msg.includes('network')) return 'Sin conexión. Revisá internet y probá de nuevo.'
  if (msg.includes('same password') || msg.includes('different from the old')) return 'La contraseña nueva tiene que ser distinta de la anterior.'
  return 'Algo salió mal. Probá de nuevo en un momento.'
}
