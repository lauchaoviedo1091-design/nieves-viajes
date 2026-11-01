// Prueba con el cliente REAL de Supabase (vendor/supabase.js), sin internet: las llamadas a
// https://pruebanv.supabase.co las contesta este archivo imitando a Supabase (Auth, PostgREST y Storage)
// sobre la base de prueba (PGlite + instalar.sql). Así se comprueba que la app habla bien con Supabase:
// inicio de sesión, funciones, errores, fotos privadas y salida.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { crearBase, rpcSupabase, USUARIOS } from './db.mjs';
import { sembrar } from './semilla.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
// La app está en ../app (carpeta de trabajo) o en la raíz del repositorio (GitHub Pages).
const APP_DIR = fs.existsSync(path.resolve(here, '..', 'app', 'index.html')) ? path.resolve(here, '..', 'app') : path.resolve(here, '..');
const SB = 'https://pruebanv.supabase.co';
const KEY = 'sb_publishable_prueba_123';

let passed = 0, failed = 0;
const results = [];
const ok = (c, msg) => { if (c) { passed++; results.push('  ✔ ' + msg); } else { failed++; results.push('  ✘ ' + msg); } };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/js/config.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); res.end(`window.NV_CONFIG={supabaseUrl:'${SB}',supabaseKey:'${KEY}'};`); return; }
  const f = path.join(APP_DIR, p);
  if (!f.startsWith(APP_DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const URL_APP = `http://localhost:${server.address().port}/`;

const db = await crearBase();
await sembrar((fn, p) => rpcSupabase(db, USUARIOS.nieves, fn, p).then((r) => { if (r.error) throw new Error(r.error.message); return r.data; }));

// ---------- Imitación de Supabase ----------
const CLAVES = { [USUARIOS.nieves]: 'clave-de-nieves' };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (email) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: '00000000-0000-0000-0000-00000000000' + (email.length % 10), email, role: 'authenticated', aud: 'authenticated', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}.firma`;
const emailDe = (auth) => { try { return JSON.parse(Buffer.from(String(auth).replace(/^Bearer /, '').split('.')[1], 'base64url').toString()).email; } catch (e) { return null; } };
const usuario = (email) => ({ id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
const log = [];
let vencerSesion = false;
const fotos = new Map();
const JPG = fs.readFileSync(path.join(APP_DIR, 'img', 'logo-pdf.jpg'));

async function supabase(route) {
  const req = route.request();
  const u = new URL(req.url());
  const h = req.headers();
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: body === undefined ? '' : JSON.stringify(body) });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  log.push(`${req.method()} ${u.pathname}${u.search}`);
  // Los enlaces firmados de las fotos no llevan la clave: los autoriza el token del enlace.
  if (req.method() === 'GET' && u.pathname.startsWith('/storage/v1/object/sign/fotos/')) {
    return u.searchParams.get('token') ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: JPG }) : json(400, { message: 'missing token' });
  }
  if (h.apikey !== KEY) return json(401, { message: 'Invalid API key' });

  if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') {
    const b = JSON.parse(req.postData() || '{}');
    const email = String(b.email || '').toLowerCase();
    if (CLAVES[email] !== b.password) return json(400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials', message: 'Invalid login credentials' });
    return json(200, { access_token: jwt(email), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + email, user: usuario(email) });
  }
  if (u.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  if (u.pathname === '/auth/v1/user' && req.method() === 'PUT') return json(200, usuario(emailDe(h.authorization)));
  if (u.pathname === '/auth/v1/user') return json(200, usuario(emailDe(h.authorization)));

  const m = u.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
  if (m) {
    const email = emailDe(h.authorization);
    if (!email) return json(401, { code: 'PGRST301', message: 'No suitable key or wrong key type', details: null, hint: null });
    if (vencerSesion) return json(401, { code: 'PGRST301', message: 'JWT expired', details: null, hint: null });
    const body = JSON.parse(req.postData() || '{}');
    const r = await rpcSupabase(db, email, m[1], body.p);
    if (r.error) return json(400, { code: r.error.code, message: r.error.message, details: r.error.details || null, hint: r.error.hint || null });
    return json(200, r.data);
  }
  const up = u.pathname.match(/^\/storage\/v1\/object\/fotos\/(.+)$/);
  if (up && req.method() === 'POST') {
    const p = decodeURIComponent(up[1]);
    fotos.set(p, (req.postDataBuffer() || Buffer.alloc(0)).length);
    return json(200, { Key: 'fotos/' + p, Id: 'id-' + fotos.size });
  }
  if (u.pathname === '/storage/v1/object/sign/fotos' && req.method() === 'POST') {
    const b = JSON.parse(req.postData() || '{}');
    return json(200, b.paths.map((p) => (fotos.has(p) ? { error: null, path: p, signedURL: `/object/sign/fotos/${p}?token=t-${b.expiresIn}` } : { error: 'Object not found', path: p, signedURL: null })));
  }
  return json(404, { message: 'no implementado: ' + u.pathname });
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await ctx.route(SB + '/**', supabase);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push('console: ' + m.text()); });
  const settle = () => page.waitForFunction(() => window.NV && window.NV.pending === 0 && window.NV.busy === 0);

  results.push('Cliente real de Supabase (supabase-js ' + (() => { try { return require('@supabase/supabase-js/package.json').version; } catch (e) { return 'incluido en vendor/'; } })() + ')');
  await page.goto(URL_APP);
  await page.waitForSelector('#login:not([hidden])');
  ok(!log.some((x) => x.includes('/rest/')), 'Sin sesión no se pide ningún dato a la base');
  await page.fill('#login-email', USUARIOS.nieves);
  await page.fill('#login-pass', 'mal');
  await page.click('#login-btn');
  await page.waitForSelector('#login-err:has-text("no son correctos")');
  ok(true, 'Contraseña equivocada → "El mail o la contraseña no son correctos."');
  await page.fill('#login-pass', CLAVES[USUARIOS.nieves]);
  await page.click('#login-btn');
  await page.waitForSelector('h1:has-text("Hola, Nieves")');
  ok(log.includes('POST /auth/v1/token?grant_type=password') && log.includes('POST /rest/v1/rpc/app_datos'), 'Entra con mail y contraseña y trae los datos con la función app_datos');
  ok((await page.$$('.trip-card')).length === 3, 'Muestra los viajes de la base');
  ok(await page.evaluate(() => Object.keys(localStorage).some((k) => k === 'nv-sesion')), 'La sesión queda guardada en el dispositivo (no hay que entrar cada vez)');

  await page.click('#nav button[data-v="clientes"]');
  await page.click('[data-act="clientNew"]');
  await page.fill('#cf-fn', 'Otra');
  await page.fill('#cf-ln', 'Persona');
  await page.fill('#cf-dnum', '90237911');
  await page.click('[data-act="clientSave"]');
  await settle();
  const err = await page.textContent('#modal #err');
  ok(err.includes('Ya existe Marta Gómez') && await page.isVisible('#modal #err button:has-text("Usar a Marta Gómez")'), 'Un error de la base llega con su explicación y el botón «Usar a Marta Gómez»');
  await page.click('#modal [data-act="close"]');

  await page.click('#nav button[data-v="viajes"]');
  await page.click('button.stretch:has-text("Valle Hermoso")');
  await page.click('[data-act="tripEdit"]');
  await page.setInputFiles('#tf-photo', path.join(APP_DIR, 'img', 'logo-pdf.jpg'));
  await page.waitForSelector('#tf-prev img');
  await page.click('[data-act="tripSave"]');
  await settle();
  const subida = log.find((x) => x.startsWith('POST /storage/v1/object/fotos/viajes/'));
  ok(!!subida && [...fotos.values()][0] > 1000, 'La foto se sube a la carpeta privada "fotos": ' + (subida || '').replace('POST ', ''));
  await page.reload();
  await page.waitForSelector('h1:has-text("Valle Hermoso"), h1:has-text("Hola, Nieves")');
  await page.click('#nav button[data-v="viajes"]');
  await page.waitForSelector('.trip-card:has-text("Valle Hermoso") .trip-img img');
  const src = await page.getAttribute('.trip-card:has-text("Valle Hermoso") .trip-img img', 'src');
  ok(src.startsWith(SB + '/storage/v1/object/sign/fotos/viajes/') && src.includes('token='), 'En otra sesión la foto se ve con un enlace firmado y temporal');
  const cargo = await page.waitForFunction(() => { const i = document.querySelector('.trip-card .trip-img img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 }).then(() => true, () => false);
  ok(cargo, 'La foto se carga (permitida por la política de seguridad de la página)');

  await page.click('#nav button[data-v="config"]');
  await page.click('[data-act="passNew"]');
  await page.fill('#pw-1', 'una-clave-nueva');
  await page.fill('#pw-2', 'una-clave-nueva');
  await page.click('[data-act="passDo"]');
  await settle();
  ok(log.includes('PUT /auth/v1/user'), 'Cambiar la contraseña usa el servicio de usuarios de Supabase');

  vencerSesion = true;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForSelector('#login-err:has-text("La sesión se cerró")');
  ok(await page.isHidden('.shell'), 'Si la sesión vence, vuelve a pedir la contraseña sin mostrar datos');
  vencerSesion = false;
  await page.fill('#login-email', USUARIOS.nieves);
  await page.fill('#login-pass', CLAVES[USUARIOS.nieves]);
  await page.click('#login-btn');
  await page.waitForSelector('h1:has-text("Hola, Nieves")');
  await page.click('.side-foot [data-act="logout"]');
  await page.waitForSelector('#login:not([hidden])');
  ok(log.some((x) => x.startsWith('POST /auth/v1/logout')) && await page.evaluate(() => !localStorage.getItem('nv-sesion') && !localStorage.getItem('nv-datos-v1')), 'Salir cierra la sesión en Supabase y borra los datos del dispositivo');
  ok(errors.length === 0, 'Sin errores en la página' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) {
  results.push('\nERROR INESPERADO: ' + e.message + '\n' + e.stack);
  failed++;
} finally {
  console.log(results.join('\n'));
  console.log(`\n${passed} correctas, ${failed} con error`);
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
}
