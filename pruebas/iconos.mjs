import sharp from 'sharp'
// Ícono de Saldo: gota sobre fondo ámbar (mismo dibujo que el logo de la app)
const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 112}" fill="#E8A33D"/>
  <g transform="translate(256 256) scale(${pad ? 8.2 : 10.5}) translate(-13 -13)">
    <path d="M13 3C13 3 8.5 6 8.5 11C8.5 13.8 10.2 16 13 16.5C15.8 16 17.5 13.8 17.5 11C17.5 6 13 3 13 3Z" fill="#2B2F36"/>
    <path d="M10 21H16M13 16.5V22" stroke="#2B2F36" stroke-width="1.75" stroke-linecap="round" fill="none"/>
  </g>
</svg>`
const out = 'public/icons/'
await sharp(Buffer.from(svg(false))).resize(192).png().toFile(out + 'icon-192.png')
await sharp(Buffer.from(svg(false))).resize(512).png().toFile(out + 'icon-512.png')
await sharp(Buffer.from(svg(true))).resize(512).png().toFile(out + 'maskable-512.png')
await sharp(Buffer.from(svg(true))).resize(180).png().toFile(out + 'apple-touch-icon.png')
await sharp(Buffer.from(svg(false))).resize(64).png().toFile(out + 'favicon-64.png')
console.log('íconos listos')
