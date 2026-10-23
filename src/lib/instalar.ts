/* Instalar Saldo como app en el celular (PWA) */
import { useCallback, useEffect, useState } from 'react'

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

export type ModoInstalar = 'boton' | 'ios' | 'android-manual' | null

const CLAVE_CERRADO = 'saldo:installDismissed'
const DIAS_SIN_MOSTRAR = 5

export const yaInstalada = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true)

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent)
export const esIOS = () =>
  /iphone|ipad|ipod/i.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const esAndroid = () => /android/i.test(ua())
export const esCelular = () => esIOS() || esAndroid() || /mobile/i.test(ua())

function cerradoHace(): number {
  try {
    const t = Number(localStorage.getItem(CLAVE_CERRADO) || 0)
    return t ? (Date.now() - t) / 86400000 : Infinity
  } catch { return Infinity }
}

/**
 * Estado de instalación:
 * - modo 'boton': el navegador (Chrome/Edge en Android o computadora) permite instalar con un toque
 * - modo 'ios': iPhone/iPad, se instala desde Compartir → Agregar a inicio
 * - modo 'android-manual': Android sin el aviso automático (Samsung Internet, Firefox): desde el menú del navegador
 */
export function useInstalar() {
  const [evento, setEvento] = useState<InstallEvent | null>(() => (window.__saldoInstall as InstallEvent) ?? null)
  const [instalada, setInstalada] = useState(yaInstalada)
  const [listo, setListo] = useState(false)
  const [cerrado, setCerrado] = useState(() => cerradoHace() < DIAS_SIN_MOSTRAR)

  useEffect(() => {
    const alListo = () => setEvento((window.__saldoInstall as InstallEvent) ?? null)
    const alInstalar = () => { setInstalada(true); setEvento(null); window.__saldoInstall = null }
    window.addEventListener('saldo-install-ready', alListo)
    window.addEventListener('appinstalled', alInstalar)
    // el aviso automático puede tardar unos segundos: esperamos antes de mostrar instrucciones manuales
    const t = setTimeout(() => setListo(true), 2500)
    return () => {
      window.removeEventListener('saldo-install-ready', alListo)
      window.removeEventListener('appinstalled', alInstalar)
      clearTimeout(t)
    }
  }, [])

  const modo: ModoInstalar = instalada
    ? null
    : evento ? 'boton'
    : esIOS() ? 'ios'
    : esAndroid() && listo ? 'android-manual'
    : null

  const instalar = useCallback(async () => {
    if (!evento) return false
    await evento.prompt()
    const { outcome } = await evento.userChoice
    window.__saldoInstall = null
    setEvento(null)
    if (outcome === 'accepted') setInstalada(true)
    return outcome === 'accepted'
  }, [evento])

  const cerrar = useCallback(() => {
    try { localStorage.setItem(CLAVE_CERRADO, String(Date.now())) } catch { /* nada */ }
    setCerrado(true)
  }, [])

  return {
    modo,
    /** mostrar el aviso automático (solo en celular, si no lo cerró hace poco) */
    mostrarAviso: modo !== null && !cerrado && esCelular(),
    instalar,
    cerrar,
  }
}
