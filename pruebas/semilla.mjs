// Datos de prueba (los mismos de la etapa 1), cargados a través de las funciones de la base.

// --- Plano (copia de la lógica de la app) ---
function genFloor(floor, count, pattern) {
  const cols = pattern === '2+1' ? [0, 1, 3] : [0, 1, 3, 4];
  const per = cols.length, out = [];
  const full = Math.floor(count / per), rem = count % per;
  for (let r = 0; r < full; r++) for (const c of cols) out.push({ floor, r, c });
  if (rem === 1 && full > 0) out.push({ floor, r: full - 1, c: 2 });
  else for (let i = 0; i < rem; i++) out.push({ floor, r: full, c: cols[i] });
  return out;
}
const floorOrder = (order) => (order === 'baja' ? ['baja', 'alta', 'unica'] : ['unica', 'alta', 'baja']);
function numberSeats(seats, order) {
  const fo = floorOrder(order);
  [...seats].sort((a, b) => fo.indexOf(a.floor) - fo.indexOf(b.floor) || a.r - b.r || a.c - b.c)
    .forEach((s, i) => { s.num = String(i + 1); });
}
export function genLayout(type, cap, lower, order) {
  let seats;
  if (type === 'combi') seats = genFloor('unica', cap, '2+1');
  else if (type === 'micro1') seats = genFloor('unica', cap, '2+2');
  else { const lo = Math.min(Math.max(lower, 1), cap - 1); seats = [...genFloor('alta', cap - lo, '2+2'), ...genFloor('baja', lo, '2+1')]; }
  seats.forEach((s) => { s.id = `${s.floor}-${s.r}-${s.c}`; });
  numberSeats(seats, order || 'alta');
  return seats;
}

const pad = (n) => String(n).padStart(2, '0');
export function hoyAR() {
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function dias(n) {
  const [y, m, d] = hoyAR().split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}

// call(fn, p) debe llamar a la función como un usuario autorizado.
export async function sembrar(call) {
  const D = dias;
  const datos = await call('app_datos');
  const P = Object.fromEntries(datos.points.map((p) => [p.name, p.id]));
  const pTerm = P['Terminal de Ómnibus Rosario'], pCentro = P['Rosario Centro'], pSur = P['Rosario Zona Sur'],
    pNorte = P['Rosario Zona Norte'], pSL = P['San Lorenzo'];
  await call('guardar_lugar', { id: pCentro, name: 'Rosario Centro', address: 'Dirección de ejemplo', reference: 'Completá la dirección real' });

  const CL = [
    ['Marta', 'Gómez', '1956-03-14', { emergencyName: 'Rubén Gómez (esposo)' }], ['Rubén', 'Gómez', '1953-08-02'], ['Graciela', 'Fernández', '1960-11-21'], ['Norma', 'López', '1949-05-09'],
    ['Susana', 'Martínez', '1958-01-30'], ['Carlos', 'Romero', '1962-07-18'], ['Alicia', 'Sosa', '1955-12-03'], ['Beatriz', 'Torres', '1964-04-25'],
    ['Hugo', 'Álvarez', '1951-09-12'], ['Liliana', 'Ruiz', '1966-02-08'], ['Silvia', 'Benítez', '1959-06-27'], ['Mirta', 'Acosta', '1950-10-15'],
    ['Roberto', 'Medina', '1957-03-03'], ['Elena', 'Suárez', '1961-08-19'], ['Ana María', 'Castro', '1954-01-11'], ['Jorge', 'Giménez', '1952-12-29'],
    ['Rosa', 'Molina', '1948-07-07', { notes: 'Celíaca: avisar al hotel' }], ['Cristina', 'Ortiz', '1963-09-05'], ['Daniel', 'Silva', '1967-05-23'], ['Patricia', 'Ramírez', '1965-11-02'],
    ['Juan Carlos', 'Rojas', '1950-02-17'], ['Teresa', 'Luna', '1953-06-10'], ['Oscar', 'Ponce', '1949-04-04'], ['Nélida', 'Ríos', '1947-09-28'],
    ['Raúl', 'Cabrera', '1958-12-12'], ['Estela', 'Vega', '1962-03-21'], ['Mónica', 'Godoy', '1968-08-08'], ['Alberto', 'Paz', '1955-10-30'],
    ['Irma', 'Morales', '1951-01-19'], ['Héctor', 'Ibáñez', '1954-05-15'], ['Delia', 'Peralta', '1957-07-26'], ['Ricardo', 'Correa', '1960-09-09'],
    ['Gladys', 'Aguirre', '1952-11-13'], ['Luis', 'Navarro', '1959-02-24'], ['Olga', 'Domínguez', '1946-06-06'], ['Miguel', 'Vera', '1963-12-01'],
    ['Haydée', 'Quiroga', '1949-03-31', { notes: 'Viaja con bastón; prefiere planta baja' }], ['Stella Maris', 'Figueroa', '1958-10-04'], ['Ernesto', 'Ledesma', '1956-04-16'], ['Amalia', 'Bustos', '1961-07-22'],
    ['Lucía', 'Herrera', '1990-05-12'], ['Martín', 'Herrera', '1988-09-03'], ['Tomás', 'Herrera', D(-300)], ['Inés', 'Pereyra', '1970-01-28', { docType: 'Pasaporte', docNumber: 'AB123456', docCountry: 'Uruguay' }],
    ['Sergio', 'Ojeda', '', { docNumber: '' }], ['Viviana', 'Miranda', ''], ['Mabel', 'Juárez', '1954-08-30'], ['Carmen', 'Pereyra', '1945-02-14'],
  ];
  const K = {};
  for (let i = 0; i < CL.length; i++) {
    const x = CL[i], extra = x[3] || {};
    const r = await call('guardar_cliente', {
      firstName: x[0], lastName: x[1], birthDate: x[2], docType: extra.docType || 'DNI',
      docNumber: extra.docNumber !== undefined ? extra.docNumber : String(90100000 + (i + 1) * 137911),
      docCountry: extra.docCountry || '', phone: `341 555-${String(1000 + (i + 1) * 137).slice(-4)}`,
      emergencyName: extra.emergencyName || '', emergencyPhone: extra.emergencyName ? '341 555-0199' : '', notes: extra.notes || '',
    });
    K[`${x[0]} ${x[1]}`] = r.id;
  }

  const trips = {};
  async function mk(o) {
    const seats = genLayout(o.type, o.capacity, o.lower || 0, 'alta');
    const r = await call('guardar_viaje', { ...o, seats, layoutConfirmed: false, art: o.art });
    trips[o.name] = { id: r.id, seats, price: o.price };
    return trips[o.name];
  }
  const sid = (t, n) => t.seats.find((s) => s.num === String(n)).id;
  async function R(t, k, n, pk, o = {}) {
    const r = await call('crear_reserva', {
      tripId: t.id, clientId: K[k], seatId: n ? sid(t, n) : null, infantOf: o.infantOf || null, pickupId: pk,
      price: o.price ?? t.price, priceReason: o.reason || '', groupWith: o.groupWith || null,
    });
    return r.id;
  }
  async function PAY(rid, amount, method, date, note) {
    return call('registrar_pago', { date, method, amount, note: note || '', alloc: [{ r: rid, amt: amount }] });
  }
  const methods = ['Efectivo', 'Transferencia', 'Mercado Pago'];

  // Viaje realizado: Melincué
  const tMel = await mk({ name: 'Escapada a Melincué', province: 'Santa Fe', city: 'Melincué', departDate: D(-33), departTime: '07:00', returnDate: D(-33), returnTime: '21:00', type: 'micro1', capacity: 45, price: 65000, art: 'lago', meals: 'Almuerzo y merienda', includes: 'Traslado ida y vuelta, almuerzo con bebidas, merienda y coordinación', pickups: [{ pointId: pTerm, time: '07:00' }, { pointId: pSur, time: '07:20' }] });
  await call('bloquear_butaca', { tripId: tMel.id, seatId: sid(tMel, 1), reason: 'Coordinación', name: 'Nieves' });
  let melG = null;
  const melPax = ['Marta Gómez', 'Rubén Gómez', 'Graciela Fernández', 'Norma López', 'Carlos Romero', 'Alicia Sosa', 'Hugo Álvarez', 'Silvia Benítez', 'Mirta Acosta', 'Roberto Medina', 'Ana María Castro', 'Rosa Molina', 'Juan Carlos Rojas', 'Teresa Luna', 'Nélida Ríos', 'Estela Vega', 'Irma Morales', 'Delia Peralta', 'Gladys Aguirre', 'Olga Domínguez'];
  for (let i = 0; i < melPax.length; i++) {
    const k = melPax[i];
    const rid = await R(tMel, k, i + 3, i % 3 === 2 ? pSur : pTerm, k === 'Rubén Gómez' ? { groupWith: melG } : {});
    if (k === 'Marta Gómez') melG = rid;
    await PAY(rid, 65000, methods[i % 3], D(-48 + Math.floor(i / 2)));
  }

  // Día de campo en San Pedro (combi)
  const tSP = await mk({ name: 'Día de campo en San Pedro', province: 'Buenos Aires', city: 'San Pedro', departDate: D(11), departTime: '06:30', returnDate: D(11), returnTime: '21:30', type: 'combi', capacity: 15, price: 85000, art: 'campo', meals: 'Parrillada libre y postre', includes: 'Traslado, parrillada libre con bebida, postre, baile, visita guiada a la estancia y coordinación', pickups: [{ pointId: pTerm, time: '06:30' }, { pointId: pNorte, time: '06:50' }] });
  await call('bloquear_butaca', { tripId: tSP.id, seatId: sid(tSP, 1), reason: 'Coordinación', name: 'Nieves' });
  const luc = await R(tSP, 'Lucía Herrera', 5, pNorte);
  const mar = await R(tSP, 'Martín Herrera', 6, pNorte, { groupWith: luc });
  await R(tSP, 'Tomás Herrera', null, pNorte, { infantOf: luc, price: 0, reason: 'Bebé' });
  await call('registrar_pago', { date: D(-6), method: 'Transferencia', amount: 120000, note: 'Pagó Lucía por los dos', alloc: [{ r: luc, amt: 60000 }, { r: mar, amt: 60000 }] });
  await PAY(await R(tSP, 'Liliana Ruiz', 2, pTerm), 85000, 'Efectivo', D(-9));
  await PAY(await R(tSP, 'Elena Suárez', 3, pTerm), 50000, 'Transferencia', D(-4), 'Seña');
  await R(tSP, 'Daniel Silva', 4, pTerm);
  await PAY(await R(tSP, 'Patricia Ramírez', 7, pNorte), 85000, 'Mercado Pago', D(-8));
  const mon = await R(tSP, 'Mónica Godoy', 8, pTerm);
  await PAY(mon, 40000, 'Efectivo', D(-12), 'Seña');
  await PAY(mon, 45000, 'Efectivo', D(-3));
  await R(tSP, 'Miguel Vera', 9, pTerm);
  await PAY(await R(tSP, 'Sergio Ojeda', 10, pTerm), 30000, 'Efectivo', D(-2), 'Seña');

  // Miramar de Ansenuza (micro de 2 pisos)
  const tMi = await mk({ name: 'Miramar de Ansenuza', province: 'Córdoba', city: 'Miramar de Ansenuza', departDate: D(24), departTime: '08:00', returnDate: D(27), returnTime: '18:00', type: 'micro2', capacity: 60, lower: 10, price: 545000, art: 'lago', hotel: 'Ansenuza Hotel Casino & Spa', meals: 'Desayuno buffet y cena', includes: 'Micro, 3 noches de hotel, desayuno y cena, pileta climatizada, circuito hídrico y caminata guiada', notes: 'La excursión en lancha no está incluida (25% de descuento).', pickups: [{ pointId: pTerm, time: '08:00' }, { pointId: pCentro, time: '08:15' }, { pointId: pSL, time: '08:45' }] });
  await call('bloquear_butaca', { tripId: tMi.id, seatId: sid(tMi, 1), reason: 'Coordinación', name: 'Nieves' });
  await call('bloquear_butaca', { tripId: tMi.id, seatId: sid(tMi, 2), reason: 'Coordinación', name: '' });
  const mg = await R(tMi, 'Marta Gómez', 3, pTerm), rg = await R(tMi, 'Rubén Gómez', 4, pTerm, { groupWith: mg });
  await call('registrar_pago', { date: D(-20), method: 'Transferencia', amount: 300000, note: 'Seña de los dos', alloc: [{ r: mg, amt: 150000 }, { r: rg, amt: 150000 }] });
  await PAY(mg, 100000, 'Efectivo', D(-5));
  const mi = [
    ['Graciela Fernández', 5, pCentro, { price: 499000, reason: 'Efectivo' }, [[499000, 'Efectivo', -15]]],
    ['Carlos Romero', 7, pTerm, {}, [[200000, 'Transferencia', -18], [145000, 'Transferencia', -3]]],
    ['Alicia Sosa', 8, pSL, {}, []], ['Beatriz Torres', 9, pTerm, {}, [[545000, 'Mercado Pago', -10]]],
    ['Hugo Álvarez', 10, pTerm, {}, [[100000, 'Efectivo', -14]]], ['Silvia Benítez', 11, pCentro, {}, [[100000, 'Efectivo', -14]]],
    ['Mirta Acosta', 12, pTerm, {}, []], ['Roberto Medina', 14, pSL, { price: 499000, reason: 'Efectivo' }, [[250000, 'Efectivo', -16], [249000, 'Efectivo', -2]]],
    ['Ana María Castro', 15, pTerm, {}, [[150000, 'Transferencia', -11]]], ['Jorge Giménez', 16, pTerm, {}, [[150000, 'Transferencia', -11]]],
    ['Rosa Molina', 17, pCentro, {}, [[545000, 'Transferencia', -21]]], ['Cristina Ortiz', 18, pTerm, {}, []],
    ['Juan Carlos Rojas', 19, pSL, {}, [[100000, 'Efectivo', -7]]], ['Teresa Luna', 20, pSL, {}, [[100000, 'Efectivo', -7]]],
    ['Oscar Ponce', 21, pTerm, {}, [[200000, 'Mercado Pago', -9]]], ['Nélida Ríos', 22, pTerm, {}, [[545000, 'Efectivo', -19]]],
    ['Estela Vega', 23, pCentro, {}, [[100000, 'Transferencia', -6]]], ['Alberto Paz', 24, pTerm, {}, []],
    ['Irma Morales', 25, pTerm, {}, [[300000, 'Transferencia', -13]]], ['Héctor Ibáñez', 26, pSL, {}, [[100000, 'Efectivo', -4]]],
    ['Delia Peralta', 27, pTerm, {}, [[545000, 'Transferencia', -17]]], ['Ricardo Correa', 28, pTerm, {}, []],
    ['Gladys Aguirre', 29, pCentro, {}, [[150000, 'Efectivo', -8]]], ['Luis Navarro', 30, pTerm, {}, [[100000, 'Mercado Pago', -5]]],
    ['Viviana Miranda', 31, pTerm, {}, [[100000, 'Efectivo', -3]]], ['Inés Pereyra', 32, pTerm, {}, [[545000, 'Transferencia', -22]]],
    ['Mabel Juárez', 33, pSL, {}, [[150000, 'Efectivo', -10]]], ['Carmen Pereyra', 34, pTerm, {}, [[200000, 'Transferencia', -12]]],
    ['Haydée Quiroga', 51, pTerm, {}, [[545000, 'Efectivo', -25]]], ['Stella Maris Figueroa', 52, pCentro, {}, [[300000, 'Transferencia', -15]]],
    ['Ernesto Ledesma', 53, pTerm, {}, [[100000, 'Efectivo', -6]]], ['Amalia Bustos', 54, pTerm, {}, []],
  ];
  for (const [k, n, pk, o, pays] of mi) {
    const rid = await R(tMi, k, n, pk, o);
    for (const [a, m, d] of pays) await PAY(rid, a, m, D(d), a < (o.price ?? tMi.price) ? 'Seña' : '');
  }
  const sus = await R(tMi, 'Susana Martínez', 6, pTerm);
  await PAY(sus, 100000, 'Efectivo', D(-12), 'Seña');
  await call('dar_de_baja', { resId: sus, reason: 'Problema familiar', money: 'saldo' });
  const rau = await R(tMi, 'Raúl Cabrera', 13, pCentro);
  await PAY(rau, 150000, 'Transferencia', D(-9), 'Seña');
  await call('dar_de_baja', { resId: rau, reason: 'Cambio de planes', money: 'pendiente' });

  // Valle Hermoso (micro de 1 piso)
  const tVH = await mk({ name: 'Valle Hermoso', province: 'Córdoba', city: 'Valle Hermoso', departDate: D(45), departTime: '07:30', returnDate: D(48), returnTime: '19:00', type: 'micro1', capacity: 60, price: 250000, art: 'sierras', hotel: 'A confirmar', meals: 'Pensión completa', includes: 'Micro, 3 noches, pensión completa, pileta climatizada y fiesta todas las noches', pickups: [{ pointId: pTerm, time: '07:30' }, { pointId: pSur, time: '07:50' }, { pointId: pNorte, time: '08:10' }] });
  await call('bloquear_butaca', { tripId: tVH.id, seatId: sid(tVH, 1), reason: 'Coordinación', name: 'Nieves' });
  const mvh = await R(tVH, 'Marta Gómez', 2, pTerm);
  await PAY(mvh, 50000, 'Efectivo', D(-8), 'Seña');
  await PAY(mvh, 80000, 'Transferencia', D(-1));
  await PAY(await R(tVH, 'Liliana Ruiz', 3, pNorte), 250000, 'Transferencia', D(-6));
  await R(tVH, 'Elena Suárez', 4, pTerm);
  await PAY(await R(tVH, 'Daniel Silva', 5, pSur), 100000, 'Efectivo', D(-4), 'Seña');
  await PAY(await R(tVH, 'Patricia Ramírez', 6, pNorte), 50000, 'Mercado Pago', D(-3), 'Seña');
  await R(tVH, 'Mónica Godoy', 7, pTerm);
  await PAY(await R(tVH, 'Olga Domínguez', 8, pSur), 250000, 'Efectivo', D(-7));
  await PAY(await R(tVH, 'Miguel Vera', 9, pTerm), 50000, 'Efectivo', D(-2), 'Seña');
  await R(tVH, 'Sergio Ojeda', 10, pTerm);
  await PAY(await R(tVH, 'Viviana Miranda', 11, pTerm), 50000, 'Efectivo', D(-2), 'Seña');
  await PAY(await R(tVH, 'Mabel Juárez', 12, pSur), 100000, 'Transferencia', D(-5), 'Seña');
  await PAY(await R(tVH, 'Graciela Fernández', 14, pTerm), 250000, 'Mercado Pago', D(-9));

  return { K, trips, P, sid };
}
