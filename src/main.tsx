import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// El navegador puede ofrecer "instalar app" antes de que React arranque: lo guardamos para usarlo después
declare global {
  interface Window { __saldoInstall?: Event | null }
}
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault()
  window.__saldoInstall = e
  window.dispatchEvent(new Event('saldo-install-ready'))
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// App instalable y disponible sin conexión (solo en la versión publicada)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* sin service worker la app igual funciona */ })
  })
}
