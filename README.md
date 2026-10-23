# Saldo · Nexo Software

App de gastos personales: cuánto podés gastar hoy hasta tu próximo cobro.

- **App publicada:** https://online-m-glitch.github.io/saldo-app/
- **Base de datos:** Supabase (proyecto `vcffpaxzehrxkuxdihdd`, tablas `saldo_*` con RLS por usuario). Migración en `base_de_datos/`.
- **Tecnología:** React 19 + Vite + Tailwind 4, instalable (PWA), funciona sin conexión y sincroniza al volver.

## Desarrollo

```bash
npm install
npm run dev        # servidor local
npm run build      # genera dist/
```

## Pruebas

```bash
npx tsx pruebas/test_calc.ts          # cálculos (presupuesto, montos, extractos, avisos)
node pruebas/test_sql.mjs             # migración y reglas de acceso (Postgres local)
npx vite preview --port 4173 &
node pruebas/test_app.mjs http://localhost:4173/   # recorrido completo con Supabase simulado
```

## Publicación

La rama `gh-pages` contiene el contenido de `dist/` y es la que publica GitHub Pages.
