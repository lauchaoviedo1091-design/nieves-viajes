// Pruebas de punta a punta de la etapa 2: la app real (app/) en Chromium, conectada a una base
// PostgreSQL de prueba (PGlite con instalar.sql) mediante un cliente que imita a Supabase.
// Prueba: entrada con usuario, los 5 casos reales, dos dispositivos a la vez, fotos, copias,
// sin conexión, celular y PDF.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { crearBase, rpcSupabase, USUARIOS } from './db.mjs';
import { sembrar, dias } from './semilla.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const XLSX = require('xlsx');
const here = path.dirname(fileURLToPath(import.meta.url));
// La app está en ../app (carpeta de trabajo) o en la raíz del repositorio (GitHub Pages).
const APP_DIR = fs.existsSync(path.resolve(here, '..', 'app', 'index.html')) ? path.resolve(here, '..', 'app') : path.resolve(here, '..');
const OUT = path.resolve(here, '..', 'out');
fs.mkdirSync(OUT, { recursive: true });

let passed = 0, failed = 0;
const results = [];
const ok = (c, msg) => { if (c) { passed++; results.push('  ✔ ' + msg); } else { failed++; results.push('  ✘ ' + msg); } };
const section = (t) => results.push('\n' + t);

// ---------- Servidor de archivos (como GitHub Pages) ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(APP_DIR, p);
  if (!f.startsWith(APP_DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const URL_APP = `http://localhost:${server.address().port}/`;

// ---------- Base de datos de prueba con los datos de ejemplo ----------
const db = await crearBase();
const t0 = Date.now();
await sembrar((fn, p) => rpcSupabase(db, USUARIOS.nieves, fn, p).then((r) => { if (r.error) throw new Error(r.error.message); return r.data; }));
const semillaMs = Date.now() - t0;
const FOTOS = new Map(); // carpeta privada de fotos (compartida entre dispositivos)
const CLAVES = { [USUARIOS.nieves]: 'clave-de-nieves', [USUARIOS.laucha]: 'clave-de-laucha', [USUARIOS.extrano]: 'clave-de-otro' };

// Cliente que imita a supabase-js: sesión, funciones (rpc) y fotos. Corre dentro de la página.
function clienteDePrueba() {
  window.NV_CREATE_CLIENT = () => {
    const KEY = 'nv-sesion-prueba';
    let session = null;
    try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    const subs = [];
    const offline = () => !navigator.onLine;
    return {
      auth: {
        async getSession() { return { data: { session }, error: null }; },
        onAuthStateChange(cb) { subs.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
        async signInWithPassword({ email, password }) {
          if (offline()) return { data: { session: null, user: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 } };
          if (!(await window.__nvLogin(email, password))) return { data: { session: null, user: null }, error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 } };
          session = { access_token: 'prueba', user: { email } };
          localStorage.setItem(KEY, JSON.stringify(session));
          subs.forEach((f) => f('SIGNED_IN', session));
          return { data: { session, user: session.user }, error: null };
        },
        async signOut() { const had = !!session; session = null; localStorage.removeItem(KEY); if (had) subs.forEach((f) => f('SIGNED_OUT', null)); return { error: null }; },
        async updateUser({ password }) {
          if (offline()) return { data: { user: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 } };
          window.__clavesCambiadas = (window.__clavesCambiadas || 0) + 1;
          return { data: { user: session.user }, error: null };
        },
      },
      async rpc(fn, args) {
        if (offline()) return { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } };
        if (!session) return { data: null, error: { message: 'JWT expired', code: 'PGRST301', details: '', hint: '' } };
        return window.__nvRpc(session.user.email, fn, (args && args.p) || {});
      },
      storage: {
        from() {
          return {
            async upload(p, blob) {
              if (offline()) return { data: null, error: { message: 'Failed to fetch' } };
              const b64 = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
              await window.__nvSubir(p, blob.type, b64);
              window.__subidas = (window.__subidas || 0) + 1;
              return { data: { path: p }, error: null };
            },
            async createSignedUrls(paths) {
              if (offline()) return { data: null, error: { message: 'Failed to fetch' } };
              return { data: await window.__nvFirmar(paths), error: null };
            },
          };
        },
      },
    };
  };
}

const browser = await chromium.launch();
async function nuevoContexto(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, serviceWorkers: 'block', ...opts });
  await ctx.exposeFunction('__nvRpc', (email, fn, p) => rpcSupabase(db, email, fn, p));
  await ctx.exposeFunction('__nvLogin', (email, pass) => CLAVES[String(email).toLowerCase()] === pass);
  await ctx.exposeFunction('__nvSubir', (p, type, b64) => { FOTOS.set(p, `data:${type};base64,${b64}`); return true; });
  await ctx.exposeFunction('__nvFirmar', (paths) => paths.map((p) => ({ path: p, signedUrl: FOTOS.get(p) || null, error: FOTOS.has(p) ? null : 'Object not found' })));
  await ctx.addInitScript(clienteDePrueba);
  return ctx;
}
function vigilar(page, errors) {
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
}
const settle = (page) => page.waitForFunction(() => window.NV && window.NV.pending === 0 && window.NV.busy === 0);
async function guardar(page, sel) { await page.click(sel); await settle(page); }
const S = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.NV.S)));
const clientId = (s, first, last) => s.clients.find((c) => c.firstName === first && c.lastName === last).id;
const tripId = (s, name) => s.trips.find((t) => t.name === name).id;
const seatId = (s, tName, num) => s.trips.find((t) => t.name === tName).seats.find((x) => x.num === String(num)).id;
const activeRes = (s, cid, tid) => s.reservations.find((r) => r.clientId === cid && r.tripId === tid && r.status === 'activa');
const paid = (page, rid) => page.evaluate((id) => window.NV.paidOf(id), rid);
const callAs = (page, fn, p) => page.evaluate(async ([fn, p]) => { try { return { data: await window.NV.call(fn, p) }; } catch (e) { return { error: e.message }; } }, [fn, p]);
async function openTrip(page, name, nav = '#nav') {
  await page.click(`${nav} button[data-v="viajes"]`);
  await page.click('[data-act="tripFilter"][data-f="todos"]');
  await page.click(`button.stretch:has-text("${name}")`);
}
async function entrar(page, email, clave) {
  await page.goto(URL_APP);
  await page.waitForSelector('#login:not([hidden])');
  await page.fill('#login-email', email);
  await page.fill('#login-pass', clave);
  await page.click('#login-btn');
}
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

try {
  // ======================= Entrada =======================
  const ctx = await nuevoContexto();
  const page = await ctx.newPage();
  const errors = [];
  vigilar(page, errors);
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });

  section(`Entrada con usuario (datos de ejemplo cargados en ${semillaMs} ms)`);
  await page.goto(URL_APP);
  await page.waitForSelector('#login:not([hidden])');
  ok(await page.isHidden('.shell') && await page.isVisible('#login-form'), 'Sin sesión se ve solo la pantalla de entrada (ningún dato)');
  await page.screenshot({ path: OUT + '/entrada.png' });
  ok((await page.evaluate(() => window.NV.S.clients.length)) === 0, 'Antes de entrar no se descargó ningún dato');
  await page.fill('#login-email', USUARIOS.nieves);
  await page.fill('#login-pass', 'cualquiera');
  await page.click('#login-btn');
  await page.waitForSelector('#login-err:has-text("no son correctos")');
  ok(true, 'Contraseña equivocada: "El mail o la contraseña no son correctos."');
  await page.check('#login-show');
  ok(await page.getAttribute('#login-pass', 'type') === 'text', 'Se puede mostrar la contraseña mientras se escribe');
  await page.uncheck('#login-show');

  await entrar(page, USUARIOS.extrano, CLAVES[USUARIOS.extrano]);
  await page.waitForSelector('#login-err:has-text("no tiene permiso")');
  ok(await page.isHidden('.shell'), 'Un mail que no está autorizado entra al sistema de usuarios pero no ve ningún dato');

  await entrar(page, USUARIOS.nieves.toUpperCase(), CLAVES[USUARIOS.nieves]);
  await page.waitForSelector('h1:has-text("Hola, Nieves")');
  ok(true, 'Nieves entra con su mail (aunque lo escriba en mayúsculas) y la saluda por su nombre');
  ok((await page.$$('.trip-card')).length === 3, 'Muestra los 3 viajes próximos');
  ok(await page.isVisible('.alerts'), 'Muestra avisos');
  ok((await page.textContent('#who-side')) === 'Nieves', 'El menú dice con qué usuario entró');
  await page.screenshot({ path: OUT + '/inicio.png' });
  await page.reload();
  await page.waitForSelector('h1:has-text("Hola, Nieves")');
  ok(await page.isHidden('#login'), 'Al volver a abrir la app sigue con la sesión iniciada');

  // ======================= Caso 1 =======================
  section('1. Cliente que repite viaje (Norma López viajó a Melincué y se suma a Valle Hermoso)');
  await openTrip(page, 'Valle Hermoso');
  await page.click('.hero-txt [data-act="wizard"]');
  await page.fill('#w-q', 'norma');
  const resultText = await page.textContent('#w-results');
  ok(resultText.includes('Norma López') && resultText.includes('1 viaje realizado'), 'La búsqueda la encuentra y avisa que ya viajó');
  await page.click('#w-results [data-act="wizPick"]:has-text("Norma López")');
  ok((await page.textContent('#modal')).includes('Ya viajó 1 vez'), 'Muestra que ya viajó 1 vez, sin volver a cargar sus datos');
  await page.click('[data-act="wizNext"]');
  await page.click('#modal label.choice:has-text("Rosario Zona Sur")');
  await page.click('#modal button.seat[aria-label^="Butaca 20,"]');
  ok((await page.textContent('#modal')).includes('Butaca elegida: 20'), 'Elige la butaca 20 en el plano');
  await page.click('[data-act="wizNext"]');
  ok(await page.inputValue('#w-price') === '250000', 'El precio del viaje se aplica solo');
  await page.check('#modal input[data-bind="dep"]');
  await page.fill('#modal input[data-bind="depAmt"]', '50.000');
  await page.click('[data-act="wizNext"]');
  const summary = await page.textContent('#modal .dl');
  ok(summary.includes('$ 50.000') && summary.includes('$ 200.000'), 'El resumen muestra la seña y el saldo');
  await guardar(page, '[data-act="wizSave"]');
  ok((await page.textContent('#modal')).includes('Reserva guardada'), 'Guarda la reserva en la base de datos');
  await page.click('#modal [data-act="close"]');
  let s = await S(page);
  const norma = clientId(s, 'Norma', 'López'), vh = tripId(s, 'Valle Hermoso');
  let rN = activeRes(s, norma, vh);
  ok(rN && s.trips.find((t) => t.id === vh).seats.find((x) => x.id === rN.seatId).num === '20', 'La reserva quedó en la butaca 20');
  ok(rN.createdBy === 'Nieves', 'Queda registrado que la cargó Nieves');
  ok(s.clients.filter((c) => c.firstName === 'Norma' && c.lastName === 'López').length === 1, 'No se duplicó el cliente');
  await page.click('#nav button[data-v="clientes"]');
  await page.fill('#client-q', 'lópez');
  await page.click('#client-list button.client-row:has-text("LÓPEZ, Norma")');
  const ficha = (await page.textContent('#view')).replace(/\s+/g, ' ');
  ok(/1\s*Viajes realizados/.test(ficha) && /1\s*Próximas reservas/.test(ficha), 'Ficha: 1 viaje realizado y 1 próxima reserva');
  const secs = await page.$$eval('#view section', (ss) => ss.map((x) => x.textContent));
  ok(secs.some((t) => t.startsWith('Próximas reservas') && t.includes('Valle Hermoso')) && secs.some((t) => t.startsWith('Viajes realizados') && t.includes('Escapada a Melincué')), 'Valle Hermoso en próximas y Melincué en realizados');

  // ======================= Caso 2 =======================
  section('2. Dos pagos parciales (250.000: paga 50.000 y después 80.000)');
  await page.click('#view section:has(h2:text("Próximas reservas")) button.row');
  await page.click('#modal .dlg-foot [data-sub="pay"]');
  await page.fill('#pay-amt', '80000');
  await page.selectOption('#pay-method', 'Transferencia');
  await page.dblclick('[data-act="payDo"]');
  await settle(page);
  const m3 = await page.textContent('#modal .money3');
  ok(m3.includes('Abonado$ 130.000') && m3.includes('Saldo$ 120.000'), 'Muestra $ 130.000 abonados y $ 120.000 pendientes (aunque se tocó dos veces)');
  rN = activeRes(await S(page), norma, vh);
  ok(await paid(page, rN.id) === 130000, 'Los dos pagos quedaron asociados a esta reserva, sin duplicarse');

  section('   Doble envío del mismo pago y anulación');
  const before = (await S(page)).payments.length;
  const pagoDoble = { date: hoy(), method: 'Efectivo', amount: 1000, alloc: [{ r: rN.id, amt: 1000 }], token: 'doble-1', creditClientId: norma };
  const d1 = await callAs(page, 'registrar_pago', pagoDoble);
  const d2 = await callAs(page, 'registrar_pago', pagoDoble);
  await page.evaluate(() => window.NV.refresh());
  ok((await S(page)).payments.length === before + 1 && d2.data && d2.data.repetido && d2.data.id === d1.data.id, 'Si el mismo pago llega dos veces (por ejemplo, por mala señal), se guarda uno solo');
  await callAs(page, 'anular_pago', { id: d1.data.id, reason: 'Prueba' });
  await page.evaluate(() => window.NV.refresh());
  ok(await paid(page, rN.id) === 130000, 'Un pago anulado deja de sumar y queda en el historial');

  // ======================= Caso 3 =======================
  section('3. Cambio de asiento (de la 20 a la 33, sin perder pagos)');
  await page.click('#modal [data-act="close"]');
  await page.click('#view section:has(h2:text("Próximas reservas")) button.row');
  await page.click('#modal [data-sub="seat"]');
  await page.click('#modal button.seat[aria-label^="Butaca 33,"]');
  await guardar(page, '[data-act="mvDo"]');
  s = await S(page); rN = activeRes(s, norma, vh);
  ok(s.trips.find((t) => t.id === vh).seats.find((x) => x.id === rN.seatId).num === '33', 'Ahora está en la butaca 33');
  ok(await paid(page, rN.id) === 130000, 'Conserva los $ 130.000 pagados');
  ok(rN.seatLog.length === 1 && rN.seatLog[0].from === '20' && rN.seatLog[0].to === '33', 'Queda registrado el cambio en el historial');
  await page.click('#modal [data-act="close"]');
  await openTrip(page, 'Valle Hermoso');
  await page.click('.tabs [data-tab="butacas"]');
  ok(await page.isVisible('button.seat[aria-label="Butaca 20, libre"]') && await page.isVisible('button.seat[aria-label="Butaca 33, ocupada por Norma López"]'), 'En el plano la 20 quedó libre y la 33 ocupada por Norma');
  const dup = await callAs(page, 'crear_reserva', { tripId: vh, clientId: clientId(s, 'Beatriz', 'Torres'), seatId: seatId(s, 'Valle Hermoso', 33), pickupId: s.trips.find((t) => t.id === vh).pickups[0].pointId, price: 250000 });
  ok(dup.error && dup.error.includes('ya está ocupada'), 'La base de datos no deja asignar la butaca 33 a otra persona: "' + dup.error + '"');

  // ======================= Caso 4 =======================
  section('4. Baja con seña (lo pagado queda como saldo a favor)');
  await page.click('button.seat[aria-label="Butaca 33, ocupada por Norma López"]');
  await page.click('#modal [data-act="openRes"]');
  await page.click('#modal [data-sub="cancel"]');
  await page.fill('#c-reason', 'Prueba: no puede viajar');
  await page.check('#modal input[name="c-money"][value="saldo"]');
  await guardar(page, '[data-act="cancelDo"]');
  s = await S(page);
  const rC = s.reservations.find((r) => r.clientId === norma && r.tripId === vh);
  ok(rC.status === 'cancelada' && rC.seatId === null, 'La reserva quedó dada de baja y sin butaca');
  ok(rC.cancel.money === 'saldo' && rC.cancel.paid === 130000, 'Registra que pagó $ 130.000 y que quedó como saldo a favor');
  ok(s.payments.filter((p) => p.alloc.some((a) => a.r === rC.id) && p.status === 'valido').length === 2, 'No se borraron sus pagos');
  ok(await page.evaluate((c) => window.NV.clientCreditLeft(c), norma) === 130000, 'La ficha tiene $ 130.000 de saldo a favor');
  await page.click('#modal [data-act="close"]');
  ok(await page.isVisible('button.seat[aria-label="Butaca 33, libre"]'), 'La butaca 33 quedó libre');
  ok(/12\s*Pasajeros confirmados/.test(await page.textContent('.counters')), 'El conteo volvió a 12 pasajeros');

  section('   Usar el saldo a favor en otro viaje, una sola vez');
  await openTrip(page, 'Día de campo en San Pedro');
  await page.click('.hero-txt [data-act="wizard"]');
  await page.fill('#w-q', 'Norma');
  await page.click('#w-results [data-act="wizPick"]:has-text("Norma López")');
  ok((await page.textContent('#modal')).includes('130.000 de saldo a favor'), 'Al elegirla avisa que tiene saldo a favor');
  await page.click('[data-act="wizNext"]');
  await page.click('#modal label.choice:has-text("Terminal de Ómnibus Rosario")');
  await page.click('#modal button.seat[aria-label^="Butaca 11,"]');
  await page.click('[data-act="wizNext"]');
  await page.check('#modal input[data-bind="dep"]');
  await page.fill('#modal input[data-bind="depAmt"]', '85000');
  await page.selectOption('#modal select[data-bind="depMethod"]', 'Saldo a favor');
  await page.click('[data-act="wizNext"]');
  await guardar(page, '[data-act="wizSave"]');
  await page.click('#modal [data-act="close"]');
  ok(await page.evaluate((c) => window.NV.clientCreditLeft(c), norma) === 45000, 'Usó $ 85.000: le quedan $ 45.000');
  s = await S(page);
  const mir = tripId(s, 'Miramar de Ansenuza');
  const rMir = await callAs(page, 'crear_reserva', { tripId: mir, clientId: norma, seatId: seatId(s, 'Miramar de Ansenuza', 35), pickupId: s.trips.find((t) => t.id === mir).pickups[0].pointId, price: 545000 });
  const over = await callAs(page, 'registrar_pago', { date: hoy(), method: 'Saldo a favor', amount: 50000, alloc: [{ r: rMir.data.id, amt: 50000 }], creditClientId: norma });
  ok(over.error && over.error.includes('45.000'), 'No deja usar más saldo del que tiene: "' + over.error + '"');
  await callAs(page, 'registrar_pago', { date: hoy(), method: 'Saldo a favor', amount: 45000, alloc: [{ r: rMir.data.id, amt: 45000 }], creditClientId: norma });
  await page.evaluate(() => window.NV.refresh());
  ok(await page.evaluate((c) => window.NV.clientCreditLeft(c), norma) === 0, 'Después de usar los $ 45.000 restantes, el saldo queda en cero');

  // ======================= Caso 5 =======================
  section('5. Lista impresa actualizada');
  await openTrip(page, 'Valle Hermoso');
  await page.click('.tabs [data-tab="lista"]');
  let sheet = await page.textContent('.sheet');
  ok(!sheet.includes('LÓPEZ, Norma'), 'Norma (dada de baja) no aparece en la lista del chofer');
  ok(sheet.includes('GÓMEZ, Marta') && sheet.includes('DNI 90.237.911'), 'Aparece Marta con su DNI');
  ok(!sheet.includes('$') && !sheet.includes('Celíaca'), 'La lista no muestra pagos ni observaciones privadas');
  const firstSeats = await page.$$eval('.sheet tbody tr td.seat-c', (tds) => tds.slice(0, 4).map((t) => t.textContent));
  ok(firstSeats.join(',') === '1,2,3,4', 'Ordenada por número de butaca: ' + firstSeats.join(','));
  await page.click('[data-act="listOrder"][data-o="subida"]');
  const groups = await page.$$eval('.sheet tr.grp td', (tds) => tds.map((t) => t.textContent));
  ok(groups.length >= 3 && groups[0].startsWith('Terminal de Ómnibus Rosario · 07:30'), 'Ordenada por lugar de subida, con horario');
  await page.click('[data-act="print"]');
  ok(await page.evaluate(() => window.__printed) === 1, 'El botón Imprimir abre la impresión');
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: OUT + '/lista-impresion.pdf', format: 'A4', printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  const printTxt = execSync(`pdftotext -layout "${OUT}/lista-impresion.pdf" -`).toString();
  ok(printTxt.includes('Lista de pasajeros') && printTxt.includes('Valle Hermoso') && !printTxt.includes('LÓPEZ, Norma') && !printTxt.includes('Hola, Nieves'), 'La hoja impresa (A4) tiene solo la lista, sin el resto de la pantalla');
  await page.click('[data-act="listOrder"][data-o="butaca"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="pdf"]')]);
  const pdfPath = OUT + '/' + dl.suggestedFilename();
  await dl.saveAs(pdfPath);
  const pdfTxt = execSync(`pdftotext -layout "${pdfPath}" -`).toString();
  ok(dl.suggestedFilename().startsWith('Lista Valle Hermoso'), 'Descarga el PDF: ' + dl.suggestedFilename());
  ok(pdfTxt.includes('GÓMEZ, Marta') && !pdfTxt.includes('LÓPEZ, Norma') && pdfTxt.includes('Página 1 de 1') && pdfTxt.includes('NIEVES VIAJES'), 'El PDF tiene el logo, la lista actualizada y numeración de páginas');
  const imgs = execSync(`pdfimages -list "${pdfPath}" | tail -n +3 | wc -l`).toString().trim();
  ok(Number(imgs) >= 1, 'El PDF incluye el logo como imagen');

  // ======================= Dos dispositivos =======================
  section('Dos personas a la vez (Laucha en otro dispositivo)');
  const ctx2 = await nuevoContexto({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const cel = await ctx2.newPage();
  const errors2 = [];
  vigilar(cel, errors2);
  await entrar(cel, USUARIOS.laucha, CLAVES[USUARIOS.laucha]);
  await cel.waitForSelector('h1:has-text("Hola, Laucha")');
  ok(true, 'Laucha entra desde el celular con su propio usuario');
  await cel.screenshot({ path: OUT + '/celular-inicio.png' });
  ok((await S(cel)).reservations.some((r) => r.clientId === norma && r.status === 'cancelada'), 'Ve al instante lo que cargó Nieves (la baja de Norma)');
  await cel.click('#bottomnav button[data-v="clientes"]');
  await cel.click('[data-act="clientNew"]');
  await cel.fill('#cf-fn', 'Rita');
  await cel.fill('#cf-ln', 'Sincronizada');
  await cel.fill('#cf-dnum', '27.555.111');
  await cel.fill('#cf-birth', '1961-02-03');
  await guardar(cel, '[data-act="clientSave"]');
  ok(await cel.isVisible('h1:has-text("Rita Sincronizada")'), 'Laucha crea una clienta nueva');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => window.NV.S.clients.some((c) => c.lastName === 'Sincronizada'), null, { timeout: 5000 });
  const rita = (await S(page)).clients.find((c) => c.lastName === 'Sincronizada');
  ok(rita && rita.createdBy === 'Laucha', 'Nieves la ve sin recargar la página, con "cargó Laucha"');
  const dupCel = await callAs(cel, 'guardar_cliente', { firstName: 'Otra', lastName: 'Rita', docType: 'DNI', docNumber: '27555111' });
  ok(dupCel.error && dupCel.error.includes('Ya existe Rita Sincronizada'), 'Tampoco se puede repetir el DNI desde el otro dispositivo');

  section('   La misma butaca elegida por los dos al mismo tiempo');
  await openTrip(page, 'Valle Hermoso');
  await page.click('.hero-txt [data-act="wizard"]');
  await page.fill('#w-q', 'Sincronizada');
  await page.click('#w-results [data-act="wizPick"]:has-text("Rita Sincronizada")');
  await page.click('[data-act="wizNext"]');
  await page.click('#modal label.choice:has-text("Terminal de Ómnibus Rosario")');
  await page.click('#modal button.seat[aria-label^="Butaca 40,"]');
  await page.click('[data-act="wizNext"]');
  await page.click('[data-act="wizNext"]');
  s = await S(cel);
  const ganó = await callAs(cel, 'crear_reserva', { tripId: vh, clientId: clientId(s, 'Beatriz', 'Torres'), seatId: seatId(s, 'Valle Hermoso', 40), pickupId: s.trips.find((t) => t.id === vh).pickups[0].pointId, price: 250000 });
  ok(ganó.data && ganó.data.id, 'Laucha guarda primero a Beatriz Torres en la butaca 40');
  await guardar(page, '[data-act="wizSave"]');
  const errMsg = await page.textContent('#modal #err');
  ok(errMsg.includes('La butaca 40 ya está ocupada por Beatriz Torres'), 'A Nieves le avisa que la butaca ya está ocupada y no la pisa: "' + errMsg + '"');
  ok(await page.isVisible('#modal .step.on:has-text("Subida y butaca")') && await page.isVisible('#modal button.seat[aria-label="Butaca 40, ocupada por Beatriz Torres"]') && (await page.textContent('#modal')).includes('Butaca elegida: ninguna todavía'), 'Vuelve sola al plano, ya actualizado: la 40 figura ocupada para elegir otra');
  await page.click('#modal button.seat[aria-label^="Butaca 41,"]');
  await page.click('[data-act="wizNext"]');
  await page.click('[data-act="wizNext"]');
  await guardar(page, '[data-act="wizSave"]');
  ok((await page.textContent('#modal')).includes('Reserva guardada'), 'Elige la 41 y se guarda sin problemas');
  await page.click('#modal [data-act="close"]');

  // ======================= Fotos =======================
  section('Fotos del viaje (guardadas en la nube, privadas)');
  await page.click('#nav button[data-v="viajes"]');
  await page.click('#view [data-act="tripNew"]');
  await page.fill('#tf-name', 'Mar del Plata (prueba)');
  await page.selectOption('#tf-prov', 'Buenos Aires');
  await page.fill('#tf-city', 'Mar del Plata');
  await page.fill('#tf-dd', dias(60));
  await page.fill('#tf-rd', dias(64));
  ok((await page.textContent('#tf-dur')).includes('5 días · 4 noches'), 'Calcula días y noches al poner las fechas');
  await page.check('input[name="tf-type"][value="micro2"]');
  await page.fill('#tf-cap', '50');
  await page.fill('#tf-lower', '8');
  const pTerm = (await S(page)).points.find((p) => p.name.startsWith('Terminal')).id;
  await page.check(`#modal [data-pk="${pTerm}"]`);
  await page.fill(`#modal [data-pkt="${pTerm}"]`, '22:00');
  await page.fill('#tf-price', '300.000');
  await page.setInputFiles('#tf-photo', path.join(APP_DIR, 'img', 'logo-pdf.jpg'));
  await page.waitForSelector('#tf-prev img');
  await guardar(page, '[data-act="tripSave"]');
  ok(await page.isVisible('h1:has-text("Mar del Plata (prueba)")'), 'Crea el viaje y lo abre');
  ok(await page.evaluate(() => window.__subidas) === 1, 'La foto se subió una vez a la carpeta privada');
  const mdp = (await S(page)).trips.find((t) => t.name === 'Mar del Plata (prueba)');
  ok(/^viajes\/[0-9a-f-]+\.jpg$/.test(mdp.photo), 'El viaje guarda solo la ubicación de la foto: ' + mdp.photo);
  await page.waitForSelector('.hero-img img');
  ok((await page.getAttribute('.hero-img img', 'src')).startsWith('data:image/jpeg'), 'La foto se ve enseguida en el viaje');
  await cel.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await cel.waitForFunction(() => window.NV.S.trips.some((t) => t.name === 'Mar del Plata (prueba)'), null, { timeout: 5000 });
  await cel.click('#bottomnav button[data-v="viajes"]');
  await cel.waitForSelector('.trip-card:has-text("Mar del Plata (prueba)") .trip-img img');
  ok((await cel.getAttribute('.trip-card:has-text("Mar del Plata (prueba)") .trip-img img', 'src')).startsWith('data:image/jpeg'), 'En el celular de Laucha la foto aparece con un enlace privado y temporal');
  await page.click('.tabs [data-tab="butacas"]');
  ok(await page.isVisible('.deck-label:has-text("Planta alta")') && await page.isVisible('.deck-label:has-text("Planta baja")'), 'Micro de 2 pisos: muestra planta alta y planta baja');
  ok((await page.$$('.deck button.seat')).length === 50, 'Dibuja las 50 butacas');
  await page.click('[data-act="edStart"]');
  await page.click('button.seat[data-act="edSeat"][aria-label^="Butaca 50,"]');
  await guardar(page, '[data-act="edRemove"]');
  ok((await page.$$('.deck button.seat:not(.s-empty)')).length === 49, 'Quita una butaca libre (y se guarda en la base)');
  await page.click('button.s-empty >> nth=0');
  await page.fill('#ed-num', '50');
  await guardar(page, '[data-act="edAddDo"]');
  ok((await page.$$('.deck button.seat:not(.s-empty)')).length === 50, 'Agrega una butaca en un lugar vacío');
  await guardar(page, '[data-act="edConfirm"][data-v="1"]');
  ok(await page.isVisible('.pill:has-text("Plano confirmado")'), 'Marca el plano como confirmado');
  await page.click('[data-act="edDone"]');

  // ======================= Grupo, bebé, anulación =======================
  section('Grupo, bebé y anulación');
  await openTrip(page, 'Día de campo en San Pedro');
  await page.click('.tabs [data-tab="pagos"]');
  await page.click('.pay-row:has-text("Lucía Herrera") [data-act="resPay"]');
  await page.fill('#pay-amt', '50000');
  const alloc = await page.$$eval('[data-alloc]', (ii) => ii.map((i) => i.value));
  ok(alloc.join('|') === '25.000|25.000', 'Un pago de grupo de $ 50.000 se reparte solo: ' + alloc.join(' y '));
  await guardar(page, '[data-act="payDo"]');
  s = await S(page);
  const sp = tripId(s, 'Día de campo en San Pedro');
  ok(await paid(page, activeRes(s, clientId(s, 'Lucía', 'Herrera'), sp).id) === 85000 && await paid(page, activeRes(s, clientId(s, 'Martín', 'Herrera'), sp).id) === 85000, 'Lucía y Martín quedan pagados, cada uno con su parte');
  await page.click('.tabs [data-tab="lista"]');
  sheet = await page.textContent('.sheet');
  ok(sheet.includes('HERRERA, Tomás') && sheet.includes('bebé en brazos de Lucía Herrera'), 'El bebé aparece en la lista, en brazos de Lucía');
  ok((await page.textContent('.counters')).replace(/\s+/g, ' ').includes('y 1 bebé sin butaca'), 'El bebé no ocupa butaca y se cuenta aparte');
  await openTrip(page, 'Valle Hermoso');
  await page.click('.tabs [data-tab="pasajeros"]');
  await page.click('#pax-list button.row:has-text("Marta Gómez")');
  await page.click('#modal .paylist li:has-text("80.000") [data-act="voidAsk"]');
  await page.fill('#void-reason', 'Se cargó en la reserva equivocada');
  await guardar(page, '[data-act="voidDo"]');
  ok((await page.textContent('#modal .money3')).includes('Abonado$ 50.000'), 'Anular el pago de $ 80.000 deja $ 50.000 abonados');
  ok(await page.isVisible('#modal .paylist li.void:has-text("Se cargó en la reserva equivocada")'), 'El pago anulado queda tachado con su motivo');
  await page.click('#modal [data-act="close"]');

  // ======================= Copias de seguridad =======================
  section('Copia de seguridad');
  await page.click('#nav button[data-v="inicio"]');
  if (await page.isVisible('[data-act="alertsToggle"]')) await page.click('[data-act="alertsToggle"]');
  ok(await page.isVisible('.alerts li:has-text("Todavía no se descargó ninguna copia")'), 'Inicio recuerda que no hay ninguna copia de seguridad');
  await page.click('#nav button[data-v="config"]');
  const [xl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="exportExcel"]')]);
  const xlPath = OUT + '/' + xl.suggestedFilename();
  await xl.saveAs(xlPath);
  await settle(page);
  const wb = XLSX.readFile(xlPath);
  ok(['Clientes', 'Viajes', 'Reservas', 'Pagos', 'Devoluciones', 'Saldos a favor'].every((n) => wb.SheetNames.includes(n)), 'El Excel trae una hoja por tema: ' + wb.SheetNames.join(', '));
  const cli = XLSX.utils.sheet_to_json(wb.Sheets.Clientes);
  s = await S(page);
  ok(cli.length === s.clients.length && cli.some((r) => r.Apellido === 'Sincronizada' && r.Documento === '27555111'), `Hoja Clientes con los ${cli.length} clientes, incluida la que cargó Laucha`);
  const pagosX = XLSX.utils.sheet_to_json(wb.Sheets.Pagos);
  ok(pagosX.some((r) => r.Estado === 'Anulado' && r['Motivo de anulación'] === 'Se cargó en la reserva equivocada'), 'La hoja Pagos incluye los anulados con su motivo');
  await page.waitForSelector('#view :text("la descargó Nieves")');
  ok(true, 'Configuración muestra la fecha de la última copia y quién la descargó');
  await page.screenshot({ path: OUT + '/configuracion.png', fullPage: true });
  await page.click('#nav button[data-v="inicio"]');
  ok(!(await page.isVisible('.alerts li:has-text("copia de seguridad")')), 'Después de descargarla, el aviso de Inicio desaparece');
  await cel.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await cel.waitForFunction(() => window.NV.S.lastBackup && window.NV.S.lastBackup.by === 'Nieves', null, { timeout: 5000 });
  ok(true, 'En el celular de Laucha también figura la copia que hizo Nieves');
  await page.click('#nav button[data-v="config"]');
  const [js] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="exportJson"]')]);
  const jsData = JSON.parse(fs.readFileSync(await js.path(), 'utf8'));
  ok(jsData.clients.length === s.clients.length && jsData.payments.length === s.payments.length && jsData.exportado, 'La copia completa trae todos los datos');

  section('Contraseña y salida');
  await page.click('[data-act="passNew"]');
  await page.fill('#pw-1', 'nueva-clave-1');
  await page.fill('#pw-2', 'otra-cosa-22');
  await guardar(page, '[data-act="passDo"]');
  ok((await page.textContent('#modal #err')).includes('no son iguales'), 'Avisa si las dos contraseñas no coinciden');
  await page.fill('#pw-2', 'nueva-clave-1');
  await guardar(page, '[data-act="passDo"]');
  ok(await page.evaluate(() => window.__clavesCambiadas) === 1 && await page.isHidden('#modal .dialog'), 'Cambia la contraseña desde Configuración');
  await page.click('.side-foot [data-act="logout"]');
  await page.waitForSelector('#login:not([hidden])');
  ok(await page.evaluate(() => localStorage.getItem('nv-datos-v1')) === null && (await page.evaluate(() => window.NV.S.clients.length)) === 0, 'Al salir no queda ningún dato en el dispositivo');

  // ======================= Celular =======================
  section('Pantalla del celular (390 px)');
  const wide = (p) => p.evaluate(() => Array.from(document.querySelectorAll('body *')).filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.sheet-wrap,.bus,.tabs')).slice(0, 4).map((e) => e.tagName + '.' + e.className + ' → ' + Math.round(e.getBoundingClientRect().right)).join(' ; '));
  const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  for (const v of ['inicio', 'viajes', 'clientes', 'caja', 'mas']) {
    await cel.click(`#bottomnav button[data-v="${v}"]`);
    const o = await overflow(cel);
    ok(o <= 0, `Sin scroll horizontal en ${v} (${o}px)` + (o > 0 ? ' ' + await wide(cel) : ''));
  }
  await cel.click('#bottomnav button[data-v="mas"]');
  await cel.click('#view [data-act="go"][data-v="config"]');
  ok(await cel.isVisible('[data-act="exportExcel"]') && await cel.isVisible('#view [data-act="logout"]'), 'En el celular, Más › Configuración tiene la copia y el botón Salir');
  await openTrip(cel, 'Miramar de Ansenuza', '#bottomnav');
  for (const tab of ['pasajeros', 'butacas', 'pagos', 'lista']) {
    await cel.click(`.tabs [data-tab="${tab}"]`);
    const o = await overflow(cel);
    ok(o <= 0, `Sin scroll horizontal en la pestaña ${tab} (${o}px)` + (o > 0 ? ' ' + await wide(cel) : ''));
  }
  await cel.screenshot({ path: OUT + '/celular-lista.png' });

  section('   Compartir el PDF desde el celular (WhatsApp, guardar, imprimir)');
  const ctx3 = await nuevoContexto({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx3.addInitScript(() => {
    navigator.canShare = () => true;
    navigator.share = async (d) => {
      if (window.__falla) { window.__falla--; throw new DOMException('Hace falta tocar', 'NotAllowedError'); }
      window.__compartidos = (window.__compartidos || []).concat(d.files.map((f) => f.name + ' (' + f.type + ', ' + f.size + ' bytes)'));
    };
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q === '(pointer:coarse)' ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q));
  });
  const cel2 = await ctx3.newPage();
  const errors3 = [];
  vigilar(cel2, errors3);
  await entrar(cel2, USUARIOS.nieves, CLAVES[USUARIOS.nieves]);
  await cel2.waitForSelector('h1:has-text("Hola, Nieves")');
  await openTrip(cel2, 'Valle Hermoso', '#bottomnav');
  await cel2.click('.tabs [data-tab="lista"]');
  ok((await cel2.textContent('[data-act="pdf"]')).includes('Compartir PDF'), 'En el celular el botón dice «Compartir PDF»');
  await cel2.click('[data-act="pdf"]');
  await cel2.waitForFunction(() => window.__compartidos && window.__compartidos.length === 1);
  const comp = await cel2.evaluate(() => window.__compartidos[0]);
  ok(comp.startsWith('Lista Valle Hermoso') && comp.includes('application/pdf'), 'Abre el menú Compartir con el PDF: ' + comp);
  await cel2.evaluate(() => { window.__falla = 1; });
  await cel2.click('[data-act="pdf"]');
  await cel2.waitForSelector('#modal :text("Archivo listo")');
  await guardar(cel2, '#modal [data-act="shareFile"]');
  ok(await cel2.evaluate(() => window.__compartidos.length) === 2 && await cel2.isHidden('#modal .dialog'), 'Si el celular pide otro toque, aparece «Archivo listo» y se comparte desde ahí');

  // ======================= Sin conexión =======================
  section('Sin conexión a internet');
  const ctx4 = await nuevoContexto({ serviceWorkers: 'allow' });
  const off = await ctx4.newPage();
  const errors4 = [];
  vigilar(off, errors4);
  await entrar(off, USUARIOS.nieves, CLAVES[USUARIOS.nieves]);
  await off.waitForSelector('h1:has-text("Hola, Nieves")');
  await off.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await off.reload();
  await off.waitForSelector('h1:has-text("Hola, Nieves")');
  ok(await off.evaluate(() => !!navigator.serviceWorker.controller), 'La app queda instalada en el dispositivo (funciona como aplicación)');
  await ctx4.setOffline(true);
  await off.reload();
  await off.waitForSelector('h1:has-text("Hola, Nieves")');
  await off.waitForSelector('#net:not([hidden])');
  ok((await off.$$('.trip-card')).length >= 3, 'Sin internet abre igual y muestra lo último que vio en este dispositivo');
  await off.screenshot({ path: OUT + '/sin-conexion.png' });
  ok(await off.isVisible('#net'), 'Avisa arriba que no hay conexión');
  await off.click('#nav button[data-v="config"]');
  await off.fill('#method-new', 'Cheque');
  await guardar(off, '[data-act="methodAdd"]');
  ok(await off.isVisible('.toast:has-text("No hay conexión. No se guardó")'), 'Si intenta guardar sin internet, avisa claramente que no se guardó');
  await ctx4.setOffline(false);
  await off.evaluate(() => window.dispatchEvent(new Event('online')));
  await off.waitForSelector('#net', { state: 'hidden' });
  ok(true, 'Cuando vuelve internet, el aviso desaparece solo');
  await guardar(off, '[data-act="methodAdd"]');
  ok((await S(off)).methods.includes('Cheque'), 'Y ahí sí se guarda');

  section('Errores de la página');
  const net = (e) => /ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e);
  const todos = [...errors, ...errors2, ...errors3, ...errors4.filter((e) => !net(e))];
  ok(todos.length === 0, todos.length ? todos.join('\n') : 'Ninguno (tampoco bloqueos de seguridad del navegador)');
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
