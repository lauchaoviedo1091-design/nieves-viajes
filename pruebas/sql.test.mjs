// Pruebas de la base de datos: permisos, reglas de negocio y casos reales.
import { crearBase, rpc, comoUsuario, USUARIOS } from './db.mjs';
import { sembrar, genLayout, dias } from './semilla.mjs';

let ok = 0, mal = 0;
const out = [];
const check = (c, msg) => { if (c) { ok++; out.push('  ✔ ' + msg); } else { mal++; out.push('  ✘ ' + msg); } };
const seccion = (t) => out.push('\n' + t);
async function falla(promesa, texto, msg) {
  try { await promesa; check(false, msg + ' (no falló)'); }
  catch (e) { check(texto instanceof RegExp ? texto.test(e.message) : e.message.includes(texto), `${msg}: "${e.message}"`); return e; }
}

const db = await crearBase();
const N = (fn, p) => rpc(db, USUARIOS.nieves, fn, p);
const L = (fn, p) => rpc(db, USUARIOS.laucha, fn, p);
const datos = () => N('app_datos');
const pagado = (S, rid) => S.payments.filter((p) => p.status === 'valido').flatMap((p) => p.alloc).filter((a) => a.r === rid).reduce((s, a) => s + a.amt, 0);

try {
  seccion('Permisos');
  await falla(rpc(db, null, 'app_datos', {}, 'anon'), /permission denied/, 'Sin sesión no se puede leer nada');
  const e1 = await falla(rpc(db, USUARIOS.extrano, 'app_datos'), 'no tiene permiso', 'Un usuario que no está autorizado no ve datos');
  check(e1 && e1.hint === 'nv_permiso', 'El error de permiso viene marcado para la app');
  await falla(rpc(db, USUARIOS.extrano, 'guardar_cliente', { firstName: 'X', lastName: 'Y' }), 'no tiene permiso', 'Un usuario no autorizado no puede cargar');
  await falla(db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ email: USUARIOS.nieves })]);
    await tx.exec('set local role authenticated');
    await tx.query('select * from public.clientes');
  }), /permission denied/, 'Ni siquiera un usuario autorizado puede leer tablas directo (solo por funciones)');
  await falla(db.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    await tx.query(`insert into public.pagos (fecha, medio, importe) values (current_date, 'Efectivo', 1)`);
  }), /permission denied/, 'Nadie puede escribir tablas directo');
  await falla(db.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    await tx.query(`select privado.pagado(gen_random_uuid())`);
  }), /permission denied/, 'Las funciones internas no se pueden llamar desde afuera');

  seccion('Carga de datos de prueba (todo por funciones)');
  const t0 = Date.now();
  const { K, trips, P, sid } = await sembrar(N);
  let S = await datos();
  check(S.clients.length === 48 && S.trips.length === 4, `48 clientes y 4 viajes cargados en ${Date.now() - t0} ms`);
  check(S.version > 100, 'La versión sube con cada cambio: ' + S.version);
  check(S.user === 'Nieves', 'Los datos dicen quién está usando la app');
  const vh = trips['Valle Hermoso'], sp = trips['Día de campo en San Pedro'], mi = trips['Miramar de Ansenuza'];

  seccion('Clientes');
  const dup = await falla(N('guardar_cliente', { firstName: 'Otra', lastName: 'Persona', docType: 'DNI', docNumber: '90.237.911' }),
    'Ya existe Marta Gómez con ese documento', 'No deja repetir un DNI aunque se escriba con puntos');
  check(dup && dup.hint === 'nv_dup_cliente' && dup.detail === K['Marta Gómez'], 'El error trae a quién corresponde el DNI repetido');
  await falla(N('guardar_cliente', { firstName: 'X', lastName: 'Y', docNumber: '12345' }), 'entre 6 y 9', 'DNI demasiado corto');
  await falla(N('guardar_cliente', { firstName: 'X', lastName: 'Y', birthDate: dias(3) }), 'no puede ser futura', 'Nacimiento en el futuro');
  await falla(N('guardar_cliente', { firstName: 'X', lastName: 'Y', docType: 'Pasaporte', docNumber: 'ZZ1' }), 'país', 'Pasaporte sin país');
  await falla(N('guardar_cliente', { firstName: '', lastName: 'Y' }), 'nombre y apellido', 'Falta el nombre');
  const nuevo = await L('guardar_cliente', { firstName: 'Ana', lastName: 'Prueba', docNumber: '031.222.333', birthDate: '1980-01-02' });
  S = await datos();
  const cNuevo = S.clients.find((c) => c.id === nuevo.id);
  check(cNuevo.docNumber === '031222333' && cNuevo.createdBy === 'Laucha', 'Guarda el DNI solo con números y quién lo cargó');
  await falla(N('guardar_cliente', { firstName: 'Ana', lastName: 'Copia', docNumber: '31222333' }), 'Ya existe Ana Prueba', 'Ceros adelante no esquivan el duplicado');

  seccion('Caso 1: cliente que repite viaje');
  const norma = K['Norma López'];
  const sid20 = sid(vh, 20);
  const tokRes = 'prueba-reserva-1';
  const r1 = await N('crear_reserva', { token: tokRes, tripId: vh.id, clientId: norma, seatId: sid20, pickupId: P['Rosario Zona Sur'], price: 250000, deposit: { amount: 50000, method: 'Efectivo', date: dias(0) } });
  const r1b = await N('crear_reserva', { token: tokRes, tripId: vh.id, clientId: norma, seatId: sid20, pickupId: P['Rosario Zona Sur'], price: 250000, deposit: { amount: 50000, method: 'Efectivo', date: dias(0) } });
  S = await datos();
  check(r1b.repetido === true && r1b.id === r1.id, 'Tocar dos veces "Guardar reserva" no crea dos reservas');
  check(S.reservations.filter((r) => r.clientId === norma && r.tripId === vh.id).length === 1, 'Norma tiene una sola reserva en Valle Hermoso');
  check(pagado(S, r1.id) === 50000, 'La seña quedó asociada a su reserva');
  check(S.reservations.filter((r) => r.clientId === norma).length === 2, 'Su historial tiene Melincué y Valle Hermoso');

  seccion('Caso 2: dos pagos parciales');
  await N('registrar_pago', { token: 'pago-80', date: dias(0), method: 'Transferencia', amount: 80000, alloc: [{ r: r1.id, amt: 80000 }] });
  const rep = await N('registrar_pago', { token: 'pago-80', date: dias(0), method: 'Transferencia', amount: 80000, alloc: [{ r: r1.id, amt: 80000 }] });
  S = await datos();
  check(rep.repetido === true && pagado(S, r1.id) === 130000, 'Pagos de 50.000 y 80.000 suman 130.000 (el doble toque no suma dos veces)');
  check(S.reservations.find((r) => r.id === r1.id).price - pagado(S, r1.id) === 120000, 'Quedan 120.000 de saldo');
  await falla(N('registrar_pago', { date: dias(0), method: 'Efectivo', amount: 130000, alloc: [{ r: r1.id, amt: 130000 }] }), 'supera el saldo de Norma López, que es de $ 120.000', 'No deja pagar de más');
  await falla(N('registrar_pago', { date: dias(1), method: 'Efectivo', amount: 1000, alloc: [{ r: r1.id, amt: 1000 }] }), 'no puede ser futura', 'Fecha de pago futura');
  await falla(N('registrar_pago', { date: dias(0), method: 'Efectivo', amount: 1000, alloc: [{ r: r1.id, amt: 900 }] }), 'El reparto suma $ 900 y el pago es de $ 1.000', 'El reparto tiene que coincidir con el pago');
  await falla(N('registrar_pago', { date: dias(0), method: '', amount: 1000, alloc: [{ r: r1.id, amt: 1000 }] }), 'medio de pago', 'Falta el medio de pago');
  const pTmp = await N('registrar_pago', { date: dias(0), method: 'Efectivo', amount: 1000, alloc: [{ r: r1.id, amt: 1000 }] });
  await falla(N('anular_pago', { id: pTmp.id, reason: '' }), 'motivo', 'Anular pide motivo');
  await N('anular_pago', { id: pTmp.id, reason: 'Se cargó dos veces' });
  S = await datos();
  const anulado = S.payments.find((p) => p.id === pTmp.id);
  check(anulado.status === 'anulado' && anulado.voidedBy === 'Nieves' && pagado(S, r1.id) === 130000, 'El pago anulado queda registrado pero no suma');
  await falla(N('anular_pago', { id: pTmp.id, reason: 'otra vez' }), 'ya estaba anulado', 'No se anula dos veces');

  seccion('Caso 3: cambio de butaca y doble asignación');
  const sid33 = sid(vh, 33);
  await N('cambiar_butaca', { resId: r1.id, seatId: sid33 });
  S = await datos();
  const rN = S.reservations.find((r) => r.id === r1.id);
  check(rN.seatId === sid33 && rN.seatLog[0].from === '20' && rN.seatLog[0].to === '33', 'Pasó de la 20 a la 33 y quedó en el historial');
  check(pagado(S, r1.id) === 130000, 'Conserva sus pagos');
  await falla(N('crear_reserva', { tripId: vh.id, clientId: K['Beatriz Torres'], seatId: sid33, pickupId: P['Terminal de Ómnibus Rosario'], price: 250000 }),
    'La butaca 33 ya está ocupada por Norma López', 'No deja vender la butaca 33 dos veces');
  await falla(N('crear_reserva', { tripId: vh.id, clientId: K['Beatriz Torres'], seatId: sid(vh, 1), pickupId: P['Terminal de Ómnibus Rosario'], price: 250000 }),
    'La butaca 1 está bloqueada (Coordinación)', 'No deja vender una butaca bloqueada');
  await falla(N('crear_reserva', { tripId: vh.id, clientId: norma, seatId: sid(vh, 40), pickupId: P['Terminal de Ómnibus Rosario'], price: 250000 }),
    'Norma López ya tiene una reserva activa', 'Una persona no puede estar dos veces en el mismo viaje');
  await falla(N('crear_reserva', { tripId: vh.id, clientId: K['Beatriz Torres'], seatId: sid(vh, 40), pickupId: P['San Lorenzo'], price: 250000 }),
    'lugar de subida', 'Solo lugares de subida del viaje');
  await falla(N('crear_reserva', { tripId: vh.id, clientId: K['Beatriz Torres'], seatId: sid(vh, 40), pickupId: P['Rosario Zona Sur'], price: 200000 }),
    'indicá el motivo', 'Un precio distinto pide motivo');
  await falla(N('cambiar_butaca', { resId: r1.id, seatId: sid(vh, 2) }), 'ya está ocupada por Marta Gómez', 'Cambiar a una butaca ocupada');

  seccion('Caso 4: baja con seña y saldo a favor');
  await N('dar_de_baja', { resId: r1.id, reason: 'No puede viajar', money: 'saldo' });
  S = await datos();
  const rC = S.reservations.find((r) => r.id === r1.id);
  check(rC.status === 'cancelada' && rC.seatId === null && rC.cancel.money === 'saldo' && rC.cancel.paid === 130000 && rC.cancel.seatNum === '33', 'Baja con $ 130.000 a favor y la butaca 33 liberada');
  check(S.payments.filter((p) => p.status === 'valido' && p.alloc.some((a) => a.r === r1.id)).length === 2, 'Los pagos no se borraron');
  const credito = S.credits.find((c) => c.originRes === r1.id);
  check(credito && credito.amount === 130000 && credito.clientId === norma, 'El saldo a favor dice de qué reserva viene');
  await falla(N('dar_de_baja', { resId: r1.id, money: 'saldo' }), 'ya no está activa', 'No se da de baja dos veces');
  const rB = await N('crear_reserva', { tripId: vh.id, clientId: K['Beatriz Torres'], seatId: sid33, pickupId: P['Terminal de Ómnibus Rosario'], price: 250000 });
  check(!!rB.id, 'La butaca 33 se puede volver a vender');
  // usar el saldo en otro viaje
  const rS = await N('crear_reserva', { tripId: sp.id, clientId: norma, seatId: sid(sp, 11), pickupId: P['Terminal de Ómnibus Rosario'], price: 85000, deposit: { amount: 85000, method: 'Saldo a favor' } });
  const rM = await N('crear_reserva', { tripId: mi.id, clientId: norma, seatId: sid(mi, 35), pickupId: P['Terminal de Ómnibus Rosario'], price: 545000 });
  await falla(N('registrar_pago', { date: dias(0), method: 'Saldo a favor', amount: 50000, alloc: [{ r: rM.id, amt: 50000 }], creditClientId: norma }),
    'El saldo a favor disponible es de $ 45.000', 'El saldo se usa una sola vez (quedan 45.000)');
  await N('registrar_pago', { date: dias(0), method: 'Saldo a favor', amount: 45000, alloc: [{ r: rM.id, amt: 45000 }], creditClientId: norma });
  S = await datos();
  check(pagado(S, rS.id) === 85000 && pagado(S, rM.id) === 45000, 'Usó 85.000 en San Pedro y 45.000 en Miramar');
  await falla(N('registrar_pago', { date: dias(0), method: 'Saldo a favor', amount: 1, alloc: [{ r: rM.id, amt: 1 }], creditClientId: norma }),
    'disponible es de $ 0', 'Sin saldo no se puede pagar con saldo');
  // baja pendiente y resolución
  const rau = S.reservations.find((r) => r.clientId === K['Raúl Cabrera']);
  await falla(N('resolver_baja', { resId: rau.id, money: 'devuelto' }), 'cómo se devolvió', 'Devolver pide el medio');
  await N('resolver_baja', { resId: rau.id, money: 'devuelto', refundMethod: 'Transferencia', refundDate: dias(0) });
  S = await datos();
  const dev = S.refunds.find((d) => d.resId === rau.id);
  check(dev && dev.amount === 150000 && S.reservations.find((r) => r.id === rau.id).cancel.money === 'devuelto', 'La baja pendiente de Raúl se resolvió como devuelta');
  await falla(N('anular_pago', { id: S.payments.find((p) => p.alloc.some((a) => a.r === rau.id)).id, reason: 'x' }), 'dada de baja', 'No se anula un pago de una baja');

  seccion('Grupos y bebés');
  const luc = S.reservations.find((r) => r.clientId === K['Lucía Herrera']);
  const mar = S.reservations.find((r) => r.clientId === K['Martín Herrera']);
  const tom = S.reservations.find((r) => r.clientId === K['Tomás Herrera']);
  check(luc.groupId && luc.groupId === mar.groupId && tom.groupId === luc.groupId, 'Lucía, Martín y el bebé Tomás están en el mismo grupo');
  check(tom.seatId === null && tom.infantOf === luc.id && tom.price === 0, 'El bebé viaja sin butaca, en brazos de Lucía');
  await N('registrar_pago', { date: dias(0), method: 'Efectivo', amount: 50000, alloc: [{ r: luc.id, amt: 25000 }, { r: mar.id, amt: 25000 }] });
  S = await datos();
  check(pagado(S, luc.id) === 85000 && pagado(S, mar.id) === 85000, 'Un pago de grupo se reparte y cada uno queda pagado');
  const gr = S.groups.find((g) => g.id === luc.groupId);
  check(gr && gr.name === 'Grupo Herrera', 'El grupo lleva el apellido');
  await N('salir_grupo', { resId: mar.id });
  S = await datos();
  check(S.reservations.find((r) => r.id === mar.id).groupId === null && S.reservations.find((r) => r.id === luc.id).groupId === luc.groupId, 'Martín sale del grupo; Lucía y Tomás siguen juntos');
  await N('salir_grupo', { resId: tom.id });
  S = await datos();
  check(S.reservations.find((r) => r.id === luc.id).groupId === null && !S.groups.some((g) => g.id === luc.groupId), 'Un grupo de una sola persona se disuelve');
  await N('unir_grupo', { resId: mar.id, otherId: luc.id });
  S = await datos();
  check(S.reservations.find((r) => r.id === mar.id).groupId && S.reservations.find((r) => r.id === mar.id).groupId === S.reservations.find((r) => r.id === luc.id).groupId, 'Se pueden volver a agrupar');

  seccion('Precio');
  const mon = S.reservations.find((r) => r.clientId === K['Mónica Godoy'] && r.tripId === sp.id);
  await falla(N('cambiar_precio', { resId: mon.id, price: 80000, reason: 'Acuerdo' }), 'Ya pagó $ 85.000', 'No baja el precio por debajo de lo pagado');
  await falla(N('cambiar_precio', { resId: mon.id, price: 85000, reason: 'x' }), 'mismo precio', 'Mismo precio');
  const ela = S.reservations.find((r) => r.clientId === K['Elena Suárez'] && r.tripId === sp.id);
  await N('cambiar_precio', { resId: ela.id, price: 80000, reason: 'Acuerdo: paga todo en efectivo' });
  S = await datos();
  const elaN = S.reservations.find((r) => r.id === ela.id);
  check(elaN.price === 80000 && elaN.priceLog.at(-1).reason === 'Acuerdo: paga todo en efectivo' && elaN.priceLog.at(-1).from === 85000, 'El cambio de precio queda con motivo y precio anterior');
  // cambio de precio del viaje: solo para quienes tenían el precio anterior
  const spT = S.trips.find((t) => t.id === sp.id);
  const base = { id: sp.id, name: spT.name, province: spT.province, city: spT.city, departDate: spT.departDate, departTime: spT.departTime, returnDate: spT.returnDate, returnTime: spT.returnTime, type: 'combi', pickups: spT.pickups, art: spT.art };
  const sinAplicar = await N('guardar_viaje', { ...base, price: 90000 });
  S = await datos();
  check(sinAplicar.updated === 0 && S.reservations.find((r) => r.clientId === K['Daniel Silva'] && r.tripId === sp.id).price === 85000, 'Cambiar el precio del viaje no toca las reservas si no se pide');
  const aplicado = await N('guardar_viaje', { ...base, price: 95000, applyPrice: true });
  check(aplicado.updated === 0, 'Aplicar solo afecta a quienes tienen el precio anterior (90.000): ninguno');
  await N('guardar_viaje', { ...base, price: 85000 });
  const aplicado2 = await N('guardar_viaje', { ...base, price: 84000, applyPrice: true });
  S = await datos();
  check(aplicado2.skipped >= 1 && S.reservations.find((r) => r.clientId === K['Mónica Godoy'] && r.tripId === sp.id).price === 85000 && S.reservations.find((r) => r.clientId === K['Daniel Silva'] && r.tripId === sp.id).price === 84000,
    `Con "aplicar": ${aplicado2.updated} actualizadas, ${aplicado2.skipped} sin cambio porque ya pagaron más`);

  seccion('Plano');
  // combi 15 -> micro de 1 piso de 20: los pasajeros conservan su número aunque cambie el lugar físico
  const antes = S.reservations.filter((r) => r.tripId === sp.id && r.status === 'activa' && r.seatId).map((r) => [r.id, spT.seats.find((s) => s.id === r.seatId).num]);
  const nuevo20 = genLayout('micro1', 20, 0, 'alta');
  await N('guardar_viaje', { ...base, price: 85000, type: 'micro1', seats: nuevo20, layoutConfirmed: false });
  S = await datos();
  const spN = S.trips.find((t) => t.id === sp.id);
  const despues = new Map(S.reservations.filter((r) => r.tripId === sp.id && r.status === 'activa' && r.seatId).map((r) => [r.id, spN.seats.find((s) => s.id === r.seatId).num]));
  check(antes.every(([id, num]) => despues.get(id) === num) && spN.seats.length === 20, 'Al cambiar de combi a micro, cada pasajero conserva su número de butaca');
  check(spN.blocks.length === 1 && spN.seats.find((s) => s.id === spN.blocks[0].seatId).num === '1', 'El bloqueo también conserva su número');
  await falla(N('guardar_viaje', { ...base, price: 85000, type: 'combi', seats: genLayout('combi', 9, 0, 'alta') }),
    'desaparecen las butacas 10, 11', 'Achicar el plano avisa qué butacas ocupadas desaparecen');
  const quitar = spN.seats.filter((s) => s.num !== '5');
  await falla(N('guardar_plano', { tripId: sp.id, seats: quitar }), 'No se puede quitar la butaca 5', 'No se puede quitar una butaca ocupada');
  const repetido = spN.seats.map((s) => (s.num === '20' ? { ...s, num: '19' } : s));
  await falla(N('guardar_plano', { tripId: sp.id, seats: repetido }), 'Ya hay otra butaca con el número 19', 'No deja dos butacas con el mismo número');
  const renum = spN.seats.map((s) => (s.num === '20' ? { ...s, num: '20A' } : s));
  await N('guardar_plano', { tripId: sp.id, seats: renum, confirmed: true });
  S = await datos();
  check(S.trips.find((t) => t.id === sp.id).layoutConfirmed === true && S.trips.find((t) => t.id === sp.id).seats.some((s) => s.num === '20A'), 'Se puede renumerar y marcar el plano como confirmado');
  await falla(N('bloquear_butaca', { tripId: sp.id, seatId: sid(sp, 5) }), 'está ocupada', 'No se bloquea una butaca ocupada');
  await falla(N('guardar_viaje', { ...base, price: 85000, type: 'micro1', pickups: [{ pointId: P['Terminal de Ómnibus Rosario'] }] }),
    'pasajeros suben en Rosario Zona Norte', 'No se quita un lugar de subida que alguien usa');
  const modelo = await N('guardar_modelo', { tripId: sp.id, name: 'Micro 20 de prueba' });
  S = await datos();
  check(S.models.some((m) => m.id === modelo.id && m.seats.length === 20 && m.type === 'micro1'), 'Se guarda un plano reutilizable');

  seccion('Configuración');
  await falla(N('guardar_medios', { methods: ['Efectivo', 'efectivo'] }), 'ya existe', 'No repite medios de pago');
  await falla(N('guardar_medios', { methods: ['Saldo a favor'] }), 'reservado', 'No usa el nombre del saldo a favor');
  await falla(N('guardar_medios', { methods: [] }), 'al menos un medio', 'Siempre queda un medio de pago');
  await N('guardar_medios', { methods: ['Efectivo', 'Transferencia', 'Mercado Pago', 'Tarjeta de débito'] });
  await falla(N('borrar_lugar', { id: P['Rosario Zona Sur'] }), 'Ese lugar está en 2 viajes', 'No se borra un lugar en uso');
  await falla(N('guardar_lugar', { name: 'galvez' }), 'Ya hay un lugar', 'No repite lugares aunque cambien tildes y mayúsculas');
  const funes = await N('guardar_lugar', { name: 'Funes', address: 'Ruta 9' });
  await N('borrar_lugar', { id: funes.id });
  S = await datos();
  check(S.methods.includes('Tarjeta de débito') && !S.points.some((p) => p.name === 'Funes'), 'Medios de pago y lugares se editan');

  seccion('Forma de los datos para la app');
  const v1 = (await N('app_version')).version;
  check(typeof v1 === 'number' && v1 === S.version, 'app_version coincide con los datos');
  const t = S.trips[0], r = S.reservations[0], p = S.payments[0];
  check(['id', 'name', 'departDate', 'seats', 'blocks', 'pickups', 'vehicle', 'price', 'layoutConfirmed'].every((k) => k in t), 'Viajes con todos sus campos');
  check(['id', 'tripId', 'clientId', 'seatId', 'pickupId', 'price', 'priceLog', 'seatLog', 'status', 'groupId', 'cancel'].every((k) => k in r), 'Reservas con todos sus campos');
  check(Array.isArray(p.alloc) && typeof p.amount === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(p.date), 'Pagos con reparto, importe y fecha');
  check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.createdAt), 'Fechas y horas en hora de Argentina');

  seccion('Copias de seguridad');
  check(S.lastBackup === null, 'Al principio no hay ninguna copia registrada');
  const vAntes = S.version;
  await L('registrar_copia');
  S = await datos();
  check(S.lastBackup && S.lastBackup.by === 'Laucha' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(S.lastBackup.at), 'Queda anotado quién descargó la última copia y cuándo');
  check(S.version === vAntes + 1, 'El otro dispositivo se entera de la copia');
  await falla(rpc(db, USUARIOS.extrano, 'registrar_copia'), 'no tiene permiso', 'Un usuario no autorizado no puede registrar copias');

  seccion('Fotos (almacenamiento privado)');
  const bk = (await db.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'fotos'`)).rows[0];
  check(bk && bk.public === false && Number(bk.file_size_limit) === 5242880 && bk.allowed_mime_types.includes('image/jpeg'), 'La carpeta de fotos es privada, con límite de 5 MB y solo imágenes');
  await comoUsuario(db, USUARIOS.nieves, `insert into storage.objects (bucket_id, name) values ('fotos', 'viajes/a.jpg')`);
  const vis = await comoUsuario(db, USUARIOS.laucha, `select name from storage.objects where bucket_id = 'fotos'`);
  check(vis.length === 1 && vis[0].name === 'viajes/a.jpg', 'Nieves sube una foto y Laucha la ve');
  const ajeno = await comoUsuario(db, USUARIOS.extrano, `select name from storage.objects where bucket_id = 'fotos'`);
  check(ajeno.length === 0, 'Un usuario no autorizado no ve ninguna foto');
  await falla(comoUsuario(db, USUARIOS.extrano, `insert into storage.objects (bucket_id, name) values ('fotos', 'viajes/b.jpg')`),
    /row-level security/, 'Un usuario no autorizado no puede subir fotos');
} catch (e) {
  out.push('\nERROR INESPERADO: ' + e.message + (e.hint ? ' | ' + e.hint : '') + '\n' + e.stack);
  mal++;
}
console.log(out.join('\n'));
console.log(`\n${ok} correctas, ${mal} con error`);
process.exit(mal ? 1 : 0);
