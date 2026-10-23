/* Íconos de categorías y de la barra inferior (trazo, 24×24) */
import type { ReactNode } from 'react'

const S = ({ children, size = 18 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)

const CAT: Record<string, ReactNode> = {
  comida: <><path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10" /><path d="M17 21V3c-2 1.5-3 4-3 7 0 1.7 1.3 3 3 3" /></>,
  transporte: <><rect x="4" y="4" width="16" height="12" rx="3" /><path d="M4 11h16M8 16v3M16 16v3" /><circle cx="8" cy="13.5" r=".8" fill="currentColor" /><circle cx="16" cy="13.5" r=".8" fill="currentColor" /></>,
  salud: <><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /><path d="M9 11h2l1-2 1.5 4 1-2H16" /></>,
  ocio: <><path d="M4 8a2 2 0 0 0 0 4v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4a2 2 0 0 1 0-4V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1Z" transform="translate(0 1.5)" /><path d="M14 5.5v13" strokeDasharray="2 2" /></>,
  vivienda: <><path d="M4 11 12 4l8 7" /><path d="M6 9.5V20h12V9.5" /><path d="M10 20v-5h4v5" /></>,
  educacion: <><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5Z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5Z" /></>,
  servicios: <path d="M13 3 5 13h6l-1 8 8-10h-6Z" />,
  otros: <><path d="M3.5 12.5 11 5h7a1 1 0 0 1 1 1v7l-7.5 7.5a1.5 1.5 0 0 1-2.1 0l-5.9-5.9a1.5 1.5 0 0 1 0-2.1Z" /><circle cx="15" cy="9" r="1.2" fill="currentColor" /></>,
  ingreso: <><path d="M12 4v10M8 10l4 4 4-4" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
}

export function IconoCategoria({ id, size = 18 }: { id: string; size?: number }) {
  return <S size={size}>{CAT[id] ?? CAT.otros}</S>
}

/** Círculo de color con el ícono de la categoría */
export function BadgeCategoria({ id, color, size = 36 }: { id: string; color: string; size?: number }) {
  return (
    <span className="rounded-full flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, background: color + '22', color }}>
      <IconoCategoria id={id} size={Math.round(size * 0.5)} />
    </span>
  )
}

export const IconoInicio = () => <S size={22}><path d="M4 10.5 12 4l8 6.5" /><path d="M6 9v11h12V9" /></S>
export const IconoHistorial = () => <S size={22}><circle cx="12" cy="12" r="8" /><path d="M12 8v4.5l3 2" /></S>
export const IconoReportes = () => <S size={22}><path d="M5 20V11M12 20V5M19 20v-6" /></S>
export const IconoMas = () => <S size={22}><circle cx="5.5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="18.5" cy="12" r="1.2" fill="currentColor" /></S>
export const IconoDescargar = ({ size = 20 }: { size?: number }) => <S size={size}><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19h14" /></S>
export const IconoCompartirIOS = ({ size = 18 }: { size?: number }) => <S size={size}><path d="M12 15V4M8.5 7.5 12 4l3.5 3.5" /><path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v7A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H16" /></S>
export const IconoAgregarInicio = ({ size = 18 }: { size?: number }) => <S size={size}><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8.5v7M8.5 12h7" /></S>
export const IconoMenuAndroid = ({ size = 18 }: { size?: number }) => <S size={size}><circle cx="12" cy="5.5" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="18.5" r="1.2" fill="currentColor" /></S>
