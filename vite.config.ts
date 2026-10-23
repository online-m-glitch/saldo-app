import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base relativa: funciona en GitHub Pages dentro de cualquier repositorio
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Supabase en un archivo aparte: cambia poco y el celular lo guarda entre versiones
        manualChunks(id) {
          if (id.includes('node_modules/@supabase')) return 'supabase'
        },
      },
    },
  },
})
