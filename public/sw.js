/* Service worker de Saldo: la app abre aunque no haya conexión.
   - Páginas: primero la red (para tener siempre la última versión); sin red, la copia guardada.
   - Archivos de la app (js/css/íconos, con nombre que cambia en cada versión): copia guardada.
   - Tipografías de Google: copia guardada y se actualiza en segundo plano.
   - Supabase (datos y login) nunca se guarda acá: lo maneja la app. */
const VERSION = 'saldo-v1'
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  if (url.hostname.endsWith('supabase.co')) return

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(VERSION).then(async c => {
        const hit = await c.match(req)
        const red = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r }).catch(() => hit)
        return hit || red
      })
    )
    return
  }

  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(r => { const copia = r.clone(); caches.open(VERSION).then(c => c.put('./index.html', copia)); return r })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    )
    return
  }

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(VERSION).then(c => c.put(req, copia)) }
      return r
    }))
  )
})
