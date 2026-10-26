import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
const hosted = process.env.NETLIFY === 'true' || process.env.CF_PAGES === '1';
const raw = process.env.PUBLIC_GAME_SERVER_URL || '';
if (hosted && !raw) throw Error('Set PUBLIC_GAME_SERVER_URL to the HTTPS Render service origin in your hosting environment settings, then redeploy.');
let serverUrl = raw;
if (raw) {
  const u = new URL(raw);
  if (u.username || u.password || u.pathname !== '/' || u.search || u.hash || !['http:', 'https:'].includes(u.protocol)) throw Error('PUBLIC_GAME_SERVER_URL must be an origin without a path or credentials');
  if (hosted && u.protocol !== 'https:') throw Error('Hosted frontend requires an HTTPS game server');
  serverUrl = u.origin;
}
await rm('dist', { recursive: true, force: true }); await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true }); await cp('shared', 'dist/shared', { recursive: true });
await mkdir('dist/vendor', { recursive: true });
await cp('node_modules/socket.io/client-dist/socket.io.min.js', 'dist/vendor/socket.io.min.js');
for (const [pkg, target] of [['noto-sans-thai','thai'], ['space-grotesk','latin']]) {
  await cp(`node_modules/@fontsource/${pkg}/files`, `dist/fonts/${target}`, { recursive: true });
  await cp(`node_modules/@fontsource/${pkg}/LICENSE`, `dist/fonts/${target}/LICENSE`);
}
await writeFile('dist/runtime-config.js', `window.MOONFALL_CONFIG = ${JSON.stringify({ serverUrl })};\n`);
console.log('Static frontend built in dist/. Game server:', serverUrl || 'same-origin development');
