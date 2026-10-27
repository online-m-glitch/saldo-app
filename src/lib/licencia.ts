/* Licencia de Saldo: se activa una vez con un código y queda para siempre */
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export type EstadoLicencia = 'cargando' | 'si' | 'no' | 'error'

const clave = (u: string) => `saldo:lic:${u}`
function leer(u: string): { licencia: boolean; admin: boolean } | null {
  try { const s = localStorage.getItem(clave(u)); return s ? JSON.parse(s) : null } catch { return null }
}
function guardar(u: string, v: { licencia: boolean; admin: boolean }) {
  try { localStorage.setItem(clave(u), JSON.stringify(v)) } catch { /* nada */ }
}
export function borrarLicenciaLocal(u: string) {
  try { localStorage.removeItem(clave(u)) } catch { /* nada */ }
}

export function useLicencia(userId: string | null) {
  const [estado, setEstado] = useState<EstadoLicencia>('cargando')
  const [admin, setAdmin] = useState(false)

  const consultar = useCallback(async () => {
    if (!userId) return
    const { data, error } = await supabase.rpc('saldo_estado')
    if (error || !data) {
      // sin conexión: se usa lo último que se supo en este dispositivo
      const c = leer(userId)
      if (c) { setEstado(c.licencia ? 'si' : 'no'); setAdmin(c.admin) } else setEstado('error')
      return
    }
    const v = { licencia: Boolean((data as { licencia?: boolean }).licencia), admin: Boolean((data as { admin?: boolean }).admin) }
    guardar(userId, v)
    setEstado(v.licencia ? 'si' : 'no')
    setAdmin(v.admin)
  }, [userId])

  useEffect(() => {
    if (!userId) { setEstado('cargando'); setAdmin(false); return }
    const c = leer(userId)
    if (c?.licencia) { setEstado('si'); setAdmin(c.admin) } else setEstado('cargando')
    void consultar()
  }, [userId, consultar])

  /** Activa con un código. Devuelve null si salió bien o un mensaje de error. */
  const activar = useCallback(async (codigo: string): Promise<string | null> => {
    const { data, error } = await supabase.rpc('saldo_activar', { p_codigo: codigo })
    if (error) return 'No pudimos verificar el código. Revisá tu conexión y probá de nuevo.'
    const r = data as { ok: boolean; error?: string }
    if (!r.ok) {
      return r.error === 'usado'
        ? 'Ese código ya se usó en otra cuenta. Cada código sirve para una sola cuenta.'
        : 'Ese código no existe. Revisalo: son letras y números (no lleva 0, O, 1 ni I).'
    }
    await consultar()
    return null
  }, [consultar])

  return { estado, admin, activar, reintentar: consultar }
}

/** Mensaje para mandarle al comprador junto con su código */
export const mensajeParaComprador = (codigo: string, appUrl: string) =>
  `¡Gracias por tu compra de Saldo!

Tu código de activación es:
${codigo}

Cómo empezar:
1. Abrí la app: ${appUrl}
2. Tocá "Registrate" y creá tu cuenta con tu email y una contraseña.
3. Cuando te lo pida, ingresá el código.

El código es para una sola cuenta y no vence. Cualquier duda, escribime por acá.`
