'use strict';
/* ================= Utilidades ================= */
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const isoOf=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const todayISO=()=>isoOf(new Date());
const dateObj=iso=>{const [y,m,d]=String(iso).split('-').map(Number);return new Date(y,m-1,d)};
const addDays=(iso,n)=>{const d=dateObj(iso);d.setDate(d.getDate()+n);return isoOf(d)};
const daysBetween=(a,b)=>Math.round((dateObj(b)-dateObj(a))/864e5);
const WD=['dom','lun','mar','mié','jue','vie','sáb'];
const WDL=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const MO=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const MOL=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function fDate(iso){if(!iso)return '—';const d=dateObj(iso);return `${WDL[d.getDay()]} ${d.getDate()} de ${MOL[d.getMonth()]}`}
const cap=s=>s?s.charAt(0).toUpperCase()+s.slice(1):s;
function fDateNum(iso){if(!iso)return '';const [y,m,d]=String(iso).split('-');return `${d}/${m}/${y}`}
function fDateLong(iso){if(!iso)return '';const d=dateObj(iso);return `${WDL[d.getDay()]} ${d.getDate()} de ${MOL[d.getMonth()]} de ${d.getFullYear()}`}
function nowStamp(){const d=new Date();return `${isoOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`}
function fStamp(s){if(!s)return '';const [d,t]=String(s).split('T');return `${fDateNum(d)}${t?' '+t:''}`}
const NUM=new Intl.NumberFormat('es-AR',{maximumFractionDigits:0});
const money=n=>'$ '+NUM.format(Math.round(n||0));
function parseMoney(v){
  if(typeof v==='number')return Number.isFinite(v)?Math.round(v):NaN;
  let s=String(v??'').replace(/[$\s]/g,'');
  if(!s)return NaN;
  if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/\./g,'');
  if(!/^\d+(\.\d+)?$/.test(s))return NaN;
  return Math.round(Number(s));
}
const norm=s=>String(s??'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim();
const digits=s=>String(s??'').replace(/\D/g,'');
const tok=()=>'k'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
function ageOf(iso){if(!iso)return null;const b=dateObj(iso),n=new Date();let a=n.getFullYear()-b.getFullYear();const m=n.getMonth()-b.getMonth();if(m<0||(m===0&&n.getDate()<b.getDate()))a--;return a}
const plural=(n,a,b)=>`${n} ${n===1?a:b}`;

/* ================= Datos ================= */
const CREDIT='Saldo a favor';
const VEH={combi:'Combi',micro1:'Micro de 1 piso',micro2:'Micro de 2 pisos'};
const FLOOR={alta:'Planta alta',baja:'Planta baja',unica:''};
const ARTS={sierras:'Sierras',lago:'Lago o laguna',campo:'Campo',mar:'Mar',ciudad:'Ciudad'};
const PROV=['Buenos Aires','CABA','Catamarca','Chaco','Chubut','Córdoba','Corrientes','Entre Ríos','Formosa','Jujuy','La Pampa','La Rioja','Mendoza','Misiones','Neuquén','Río Negro','Salta','San Juan','San Luis','Santa Cruz','Santa Fe','Santiago del Estero','Tierra del Fuego','Tucumán','Otro país'];
const REASONS=['Efectivo','Persona sola','Menor','Bebé','Acuerdo','Otro'];
const BLOCK_REASONS=['Coordinación','Chofer','Otro motivo'];
class UserError extends Error{constructor(m,extra){super(m);this.extra=extra||null}}
const fail=(m,extra)=>{throw new UserError(m,extra)};
function blank(){return{v:1,version:-1,user:'',methods:['Efectivo','Transferencia','Mercado Pago'],points:[],clients:[],trips:[],reservations:[],groups:[],payments:[],refunds:[],credits:[],models:[],lastBackup:null}}
let S=blank();

/* ================= Consultas ================= */
const tripById=id=>S.trips.find(t=>t.id===id);
const clientById=id=>S.clients.find(c=>c.id===id);
const resById=id=>S.reservations.find(r=>r.id===id);
const pointById=id=>S.points.find(p=>p.id===id);
const pointName=id=>pointById(id)?.name||'Lugar borrado';
const nameOf=c=>c?`${c.firstName} ${c.lastName}`.trim():'Cliente borrado';
const listName=c=>c?`${c.lastName.toUpperCase()}, ${c.firstName}`:'';
const initials=c=>c?((c.firstName[0]||'')+(c.lastName[0]||'')).toUpperCase():'?';
const tripEnd=t=>t.returnDate||t.departDate;
const isPast=t=>tripEnd(t)<todayISO();
const tripRes=tid=>S.reservations.filter(r=>r.tripId===tid&&r.status==='activa');
const tripCancelled=tid=>S.reservations.filter(r=>r.tripId===tid&&r.status==='cancelada');
const seatById=(t,sid)=>t.seats.find(s=>s.id===sid);
const seatNum=(t,sid)=>seatById(t,sid)?.num??'—';
function seatLabel(t,sid){const s=seatById(t,sid);if(!s)return '—';return s.floor==='baja'?`${s.num} (PB)`:s.num}
const seatOcc=(t,sid)=>S.reservations.find(r=>r.tripId===t.id&&r.status==='activa'&&r.seatId===sid);
const blockOf=(t,sid)=>t.blocks.find(b=>b.seatId===sid);
const pickupOf=(t,pid)=>t.pickups.find(p=>p.pointId===pid);
function pickupLabel(t,pid){const p=pickupOf(t,pid);return p?`${pointName(pid)}${p.time?' · '+p.time:''}`:pointName(pid)}
function numKey(s){if(!s)return 9999;const n=parseInt(s.num,10);return Number.isFinite(n)?n:5000}
function resSortKey(t,r){if(r.seatId)return numKey(seatById(t,r.seatId));const a=r.infantOf&&resById(r.infantOf);return a&&a.seatId?numKey(seatById(t,a.seatId))+0.5:9999}
function incomplete(c){if(!c)return[];const m=[];if(!c.docNumber)m.push('documento');if(!c.birthDate)m.push('nacimiento');return m}
function fDoc(c){if(!c||!c.docNumber)return '';if(c.docType==='DNI'){const d=digits(c.docNumber);return 'DNI '+(d?NUM.format(Number(d)):c.docNumber)}return `Pasaporte ${c.docNumber}${c.docCountry?' ('+c.docCountry+')':''}`}
function docShort(c){if(!c||!c.docNumber)return '';if(c.docType==='DNI')return 'DNI '+NUM.format(Number(digits(c.docNumber)));return `Pas. ${c.docNumber}${c.docCountry?' ('+c.docCountry+')':''}`}
function durationLabel(t){if(!t.returnDate||t.returnDate===t.departDate)return 'Salida de un día';const n=daysBetween(t.departDate,t.returnDate);if(n<=0)return 'Salida de un día';return `${n+1} días · ${plural(n,'noche','noches')}`}
function paidOf(rid){let s=0;for(const p of S.payments){if(p.status!=='valido')continue;for(const a of p.alloc)if(a.r===rid)s+=a.amt}return s}
const balanceOf=r=>r.price-paidOf(r.id);
function payState(r){if(r.price<=0)return 'free';const p=paidOf(r.id);if(p<=0)return 'none';if(p<r.price)return 'part';return 'full'}
function tripCounts(t){const act=tripRes(t.id);const seated=act.filter(r=>r.seatId).length;const cap=t.seats.length;const blocked=t.blocks.length;return{cap,seated,infants:act.length-seated,blocked,free:Math.max(0,cap-seated-blocked)}}
function tripMoney(t){let sold=0,paid=0;for(const r of tripRes(t.id)){sold+=r.price;paid+=paidOf(r.id)}return{sold,paid,pending:sold-paid}}
function creditUsed(cid){let s=0;for(const p of S.payments){if(p.status!=='valido'||!p.creditUses)continue;for(const u of p.creditUses)if(u.c===cid)s+=u.amt}return s}
const creditLeft=cr=>cr.amount-creditUsed(cr.id);
const clientCredits=cid=>S.credits.filter(c=>c.clientId===cid);
const clientCreditLeft=cid=>clientCredits(cid).reduce((s,c)=>s+creditLeft(c),0);
const groupOf=r=>r&&r.groupId?S.groups.find(g=>g.id===r.groupId):null;
const groupMembers=gid=>S.reservations.filter(r=>r.groupId===gid&&r.status==='activa');
const upcomingTrips=()=>S.trips.filter(t=>!isPast(t)).sort((a,b)=>(a.departDate+a.departTime).localeCompare(b.departDate+b.departTime));
function doneCount(cid){return S.reservations.filter(r=>r.clientId===cid&&r.status==='activa'&&isPast(tripById(r.tripId))).length}
const usedPoint=pid=>S.trips.filter(t=>t.pickups.some(p=>p.pointId===pid)).length;

/* ================= Plano: generación ================= */
function genFloor(floor,count,pattern){
  const cols=pattern==='2+1'?[0,1,3]:[0,1,3,4];
  const per=cols.length,out=[];
  const full=Math.floor(count/per),rem=count%per;
  for(let r=0;r<full;r++)for(const c of cols)out.push({floor,r,c});
  if(rem===1&&full>0)out.push({floor,r:full-1,c:2});
  else for(let i=0;i<rem;i++)out.push({floor,r:full,c:cols[i]});
  return out;
}
const floorOrder=order=>order==='baja'?['baja','alta','unica']:['unica','alta','baja'];
function numberSeats(seats,order){const fo=floorOrder(order);[...seats].sort((a,b)=>fo.indexOf(a.floor)-fo.indexOf(b.floor)||a.r-b.r||a.c-b.c).forEach((s,i)=>{s.num=String(i+1)})}
function genLayout(type,cap,lower,order){
  let seats;
  if(type==='combi')seats=genFloor('unica',cap,'2+1');
  else if(type==='micro1')seats=genFloor('unica',cap,'2+2');
  else{const lo=Math.min(Math.max(lower,1),cap-1);seats=[...genFloor('alta',cap-lo,'2+2'),...genFloor('baja',lo,'2+1')]}
  seats.forEach(s=>{s.id=`${s.floor}-${s.r}-${s.c}`});
  numberSeats(seats,order||'alta');
  return seats;
}

/* ================= Validaciones y cálculos locales =================
   La base de datos valida todo de nuevo al guardar; acá solo se prepara lo que se manda
   y se avisa antes cuando algo ya se sabe que no va. */
function checkSeatFree(t,sid,exceptRes){
  const s=seatById(t,sid);if(!s)fail('Elegí una butaca en el plano.');
  const b=blockOf(t,sid);if(b)fail(`La butaca ${s.num} está bloqueada (${b.reason}).`);
  const occ=S.reservations.find(r=>r.tripId===t.id&&r.status==='activa'&&r.seatId===sid&&r.id!==exceptRes);
  if(occ)fail(`La butaca ${s.num} ya está ocupada por ${nameOf(clientById(occ.clientId))}.`);
  return s;
}
function cleanNum(v){const n=String(v??'').trim().toUpperCase();if(!/^[0-9A-Z]{1,4}$/.test(n))fail('El número de butaca puede tener hasta 4 números o letras.');return n}
// Estas cuatro trabajan sobre una copia del viaje; después se manda el plano entero.
function _renumberSeat(t,sid,v){const s=seatById(t,sid);const n=cleanNum(v);if(t.seats.some(x=>x.id!==sid&&x.num===n))fail(`Ya hay otra butaca con el número ${n}.`);s.num=n}
function _removeSeat(t,sid){if(seatOcc(t,sid))fail('La butaca está ocupada: primero cambiá al pasajero de butaca.');if(blockOf(t,sid))fail('La butaca está bloqueada: primero desbloqueala.');if(t.seats.length<=1)fail('El plano necesita al menos una butaca.');t.seats=t.seats.filter(s=>s.id!==sid)}
function _addSeat(t,floor,r,c,v){if(t.seats.some(s=>s.floor===floor&&s.r===r&&s.c===c))fail('Ese lugar ya tiene una butaca.');const n=cleanNum(v);if(t.seats.some(x=>x.num===n))fail(`Ya hay otra butaca con el número ${n}.`);t.seats.push({id:`${floor}-${r}-${c}`,floor,r,c,num:n})}
function _autoNumber(t,order){numberSeats(t.seats,order)}
function nextSeatNum(t){let max=0;t.seats.forEach(s=>{const n=parseInt(s.num,10);if(Number.isFinite(n)&&n>max)max=n});return String(max+1)}
const cloneTrip=t=>JSON.parse(JSON.stringify(t));
// Lo que se manda al guardar un viaje. El plano se arma de nuevo solo si cambió el vehículo.
function tripPayload(f,id){
  const model=f.modelId?S.models.find(x=>x.id===f.modelId):null;
  const type=model?model.type:f.type;if(!VEH[type])fail('Elegí micro o combi.');
  const cap=model?model.seats.length:parseInt(f.capacity,10);
  if(!model&&!(cap>=1&&cap<=99))fail('La cantidad de butacas tiene que estar entre 1 y 99.');
  const lower=type==='micro2'?(model?model.seats.filter(s=>s.floor==='baja').length:parseInt(f.lower,10)):0;
  if(!model&&type==='micro2'&&!(lower>=1&&lower<cap))fail('Indicá cuántas butacas hay en planta baja (menos que el total).');
  const price=parseMoney(f.price);
  if(!(price>=0))fail('Escribí el precio por persona, solo con números.');
  const p={id:id||null,name:f.name,origin:f.origin,province:f.province,city:f.city,departDate:f.departDate,departTime:f.departTime,returnDate:f.returnDate,returnTime:f.returnTime,hotel:f.hotel,meals:f.meals,includes:f.includes,notes:f.notes,art:f.art,price,type,pickups:f.pickups,applyPrice:!!f.applyPrice};
  const newSeats=()=>model?model.seats.map(s=>({id:s.id,floor:s.floor,r:s.r,c:s.c,num:s.num})):genLayout(type,cap,lower,'alta');
  const t=id?tripById(id):null;
  if(!t){p.seats=newSeats();p.layoutConfirmed=!!model}
  else{
    const curLower=t.seats.filter(s=>s.floor==='baja').length;
    const changed=!!model||type!==t.vehicle.type||cap!==t.seats.length||(type==='micro2'&&lower!==curLower);
    if(changed){p.seats=newSeats();p.layoutConfirmed=!!model}
  }
  return p;
}
/* ================= Conexión con la base de datos ================= */
const CFG=window.NV_CONFIG||{};
let sb=null;              // cliente de Supabase
let session=null;
let online=true;
let busy=0;               // operaciones guardándose (mientras tanto no se refresca)
const photoUrls={};       // ruta de la foto -> enlace temporal para mostrarla
const CACHE_KEY='nv-datos-v1';
function isNetErr(e){const m=String(e&&e.message||e||'');return !(e&&e.code)&&/fetch|network|failed|load failed|timeout|abort/i.test(m)}
function toUserError(e){
  if(e instanceof UserError)return e;
  if(e&&e.code==='P0001'){
    const ue=new UserError(e.message);
    if(e.hint==='nv_dup_cliente'&&e.details)ue.extra={dupId:e.details};
    if(e.hint==='nv_permiso')ue.permiso=true;
    return ue;
  }
  if(e&&(e.code==='PGRST301'||e.code==='PGRST303'||/jwt/i.test(String(e.message||''))))return Object.assign(new UserError('La sesión se cerró. Volvé a entrar.'),{sesion:true});
  if(isNetErr(e))return Object.assign(new UserError('No hay conexión. No se guardó: revisá internet y probá de nuevo.'),{red:true});
  console.error(e);
  return new UserError('No se pudo completar. Probá de nuevo en un momento.');
}
async function call(fn,p){
  let res;
  try{res=await sb.rpc(fn,{p:p||{}})}catch(e){throw toUserError(e)}
  if(res.error)throw toUserError(res.error);
  return res.data;
}
// Guarda un cambio y trae los datos al día (también lo que cargó la otra persona).
async function mutate(fn,p){
  busy++;
  try{const out=await call(fn,p);await refresh();return out}
  finally{busy--}
}
function applySnapshot(d){
  S=Object.assign(blank(),d);
  setOnline(true);
  try{localStorage.setItem(CACHE_KEY,JSON.stringify(d))}catch(e){}
  loadPhotoUrls();
}
async function refresh(){applySnapshot(await call('app_datos'));safeRender()}
// No redibujar mientras alguien escribe en un buscador de la página.
let pendingRender=false;
function typingInView(){const a=document.activeElement;return !!(a&&a.matches&&a.matches('input,textarea,select')&&$('#view')&&$('#view').contains(a))}
function safeRender(){if(!session)return;if(typingInView()){pendingRender=true;return}pendingRender=false;render()}
document.addEventListener('focusout',()=>{if(pendingRender)setTimeout(()=>{if(pendingRender&&!typingInView())safeRender()},0)});
// Novedades de la otra persona: se revisa cada 15 segundos y al volver a la app.
let pollTimer=null;
async function poll(){
  if(!sb||!session||document.hidden||busy)return;
  try{const v=await call('app_version');setOnline(true);if(v&&v.version!==S.version&&!busy)await refresh()}
  catch(e){if(e.red)setOnline(false);else if(e.permiso||e.sesion)logout(e.message)}
}
function startPolling(){stopPolling();pollTimer=setInterval(poll,15000)}
function stopPolling(){if(pollTimer)clearInterval(pollTimer);pollTimer=null}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll()});
window.addEventListener('online',()=>poll());
window.addEventListener('offline',()=>setOnline(false));
function setOnline(v){online=v;const b=$('#net');if(b)b.hidden=v}

/* ---- Fotos de los viajes (privadas: se ven con un enlace temporal) ---- */
async function loadPhotoUrls(){
  if(!sb)return;
  const need=[...new Set(S.trips.map(t=>t.photo).filter(p=>p&&!photoUrls[p]))];
  if(!need.length)return;
  try{
    const {data,error}=await sb.storage.from('fotos').createSignedUrls(need,60*60*24*7);
    if(error||!data)return;
    let changed=false;
    data.forEach(x=>{if(x&&x.signedUrl&&x.path){photoUrls[x.path]=x.signedUrl;changed=true}});
    if(changed)safeRender();
  }catch(e){}
}
const photoSrc=t=>t&&t.photo?(photoUrls[t.photo]||null):null;
async function uploadPhoto(dataUrl){
  const blob=await (await fetch(dataUrl)).blob();
  const path=`viajes/${crypto.randomUUID?crypto.randomUUID():tok()}.jpg`;
  let res;
  try{res=await sb.storage.from('fotos').upload(path,blob,{contentType:'image/jpeg',upsert:false})}catch(e){throw toUserError(e)}
  if(res.error)throw isNetErr(res.error)?toUserError(res.error):new UserError('No se pudo subir la foto. Probá con otra o guardá el viaje sin foto.');
  photoUrls[path]=dataUrl;
  return path;
}

/* ================= Sesión ================= */
function showScreen(name,msg){
  $('#loading').hidden=name!=='loading';
  $('#login').hidden=name!=='login';
  $('#fatal').hidden=name!=='fatal';
  $('.shell').hidden=name!=='app';
  $('#bottomnav').hidden=name!=='app';
  if(name==='login'){
    $('#login-err').textContent=msg||'';
    const b=$('#login-btn');b.disabled=false;b.textContent='Entrar';
    setTimeout(()=>{const e=$('#login-email');if(e&&!e.value)e.focus()},50);
  }
  if(name==='fatal')$('#fatal-msg').textContent=msg||'';
}
async function enter(){
  let cached=null;
  try{cached=JSON.parse(localStorage.getItem(CACHE_KEY)||'null')}catch(e){}
  if(cached&&cached.v===1){S=Object.assign(blank(),cached);showScreen('app');render()}
  else showScreen('loading');
  try{
    await refresh();
    showScreen('app');render();startPolling();
  }catch(e){
    if(e.permiso||e.sesion){await logout(e.message);return}
    if(cached){setOnline(false);startPolling();toast('Sin conexión: estás viendo lo último que se guardó en este dispositivo.','bad');return}
    showScreen('fatal',e.message);
  }
}
async function doLogin(){
  const email=$('#login-email').value.trim().toLowerCase(),password=$('#login-pass').value;
  const err=$('#login-err'),btn=$('#login-btn');
  if(!email||!password){err.textContent='Escribí tu mail y tu contraseña.';return}
  btn.disabled=true;btn.textContent='Entrando…';err.textContent='';
  let res;
  try{res=await sb.auth.signInWithPassword({email,password})}catch(e){res={error:e}}
  if(res.error){
    const m=String(res.error.message||'');
    err.textContent=res.error.code==='invalid_credentials'||/invalid login/i.test(m)?'El mail o la contraseña no son correctos.':isNetErr(res.error)?'No hay conexión. Revisá internet y probá de nuevo.':'No se pudo entrar. Probá de nuevo en un momento.';
    btn.disabled=false;btn.textContent='Entrar';
    return;
  }
  session=res.data.session;
  $('#login-pass').value='';
  await enter();
}
async function logout(msg){
  stopPolling();
  session=null;
  try{localStorage.removeItem(CACHE_KEY)}catch(e){}
  S=blank();closeModal();
  Object.assign(ui,{view:'inicio',tripId:null,clientId:null,clientQ:'',paxQ:'',cajaTrip:''});
  try{await sb.auth.signOut()}catch(e){}
  showScreen('login',typeof msg==='string'?msg:'');
}

/* ---- Copia de seguridad ---- */
let xlsxReady=null;
function ensureXlsx(){if(!xlsxReady)xlsxReady=(window.XLSX?Promise.resolve():loadScript('vendor/xlsx.full.min.js')).catch(e=>{xlsxReady=null;throw e});return xlsxReady}
function backupRows(){
  const tName=id=>tripById(id)?.name||'';
  const cName=id=>{const c=clientById(id);return c?`${c.lastName}, ${c.firstName}`:''};
  const dt=iso=>iso?fDateNum(iso):'';
  return{
    Clientes:S.clients.map(c=>({Apellido:c.lastName,Nombre:c.firstName,'Tipo de documento':c.docType,Documento:c.docNumber,'País del pasaporte':c.docCountry,Nacimiento:dt(c.birthDate),Teléfono:c.phone,'Contacto de emergencia':c.emergencyName,'Teléfono de emergencia':c.emergencyPhone,Observaciones:c.notes,'Viajes realizados':doneCount(c.id),'Saldo a favor':clientCreditLeft(c.id)})),
    Viajes:S.trips.map(t=>{const k=tripCounts(t),m=tripMoney(t);return{Viaje:t.name,Destino:[t.city,t.province].filter(Boolean).join(', '),Salida:dt(t.departDate),Hora:t.departTime,Regreso:dt(t.returnDate),Vehículo:VEH[t.vehicle.type],Butacas:k.cap,Pasajeros:k.seated+k.infants,Bloqueadas:k.blocked,Libres:k.free,'Precio por persona':t.price,Vendido:m.sold,Cobrado:m.paid,Pendiente:m.pending,Hotel:t.hotel,Comidas:t.meals,Incluye:t.includes}}),
    Reservas:S.reservations.map(r=>{const t=tripById(r.tripId);return{Viaje:tName(r.tripId),Salida:t?dt(t.departDate):'',Pasajero:cName(r.clientId),Butaca:r.seatId&&t?seatLabel(t,r.seatId):r.infantOf?'Bebé':'',Subida:pointName(r.pickupId),Estado:r.status==='activa'?'Activa':'Dada de baja','Precio acordado':r.price,Abonado:paidOf(r.id),Saldo:r.status==='activa'?r.price-paidOf(r.id):0,Grupo:groupOf(r)?.name||'','Motivo de baja':r.cancel?.reason||''}}),
    Pagos:S.payments.map(p=>({Fecha:dt(p.date),Importe:p.amount,Medio:p.method,Pasajeros:p.alloc.map(a=>cName(resById(a.r)?.clientId)).join(' / '),Viaje:[...new Set(p.alloc.map(a=>tName(resById(a.r)?.tripId)))].join(' / '),Nota:p.note,Estado:p.status==='valido'?'Válido':'Anulado','Motivo de anulación':p.voidReason||'',Registró:p.by})),
    Devoluciones:S.refunds.map(d=>({Fecha:dt(d.date),Importe:d.amount,Medio:d.method,Pasajero:cName(d.clientId),Viaje:tName(resById(d.resId)?.tripId),Nota:d.note,Registró:d.by})),
    'Saldos a favor':S.credits.map(c=>({Cliente:cName(c.clientId),Importe:c.amount,Disponible:creditLeft(c),'Viene de':tName(resById(c.originRes)?.tripId),Fecha:fStamp(c.at)}))
  };
}
async function downloadExcel(){
  await ensureXlsx();
  const wb=XLSX.utils.book_new();
  for(const [name,rows] of Object.entries(backupRows())){
    const ws=XLSX.utils.json_to_sheet(rows.length?rows:[{'(sin datos)':''}]);
    XLSX.utils.book_append_sheet(wb,ws,name.slice(0,31));
  }
  const out=XLSX.write(wb,{bookType:'xlsx',type:'array'});
  const ok=await deliverFile(`Nieves Viajes - copia ${fDateNum(todayISO()).replace(/\//g,'-')}.xlsx`,new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'Copia descargada.',markBackup);
  if(ok)await markBackup();
}
async function downloadJson(){
  const data=Object.assign({},S,{exportado:new Date().toISOString()});
  const ok=await deliverFile(`Nieves Viajes - copia completa ${fDateNum(todayISO()).replace(/\//g,'-')}.json`,new Blob([JSON.stringify(data,null,1)],{type:'application/json'}),'Copia completa descargada.',markBackup);
  if(ok)await markBackup();
}
// Queda anotado quién hizo la última copia, para recordarla en Inicio.
async function markBackup(){try{await mutate('registrar_copia')}catch(e){}}

/* ================= Íconos e ilustraciones ================= */
const ICONS={
  home:'<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
  bus:'<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 18v3M16 18v3"/><circle cx="8" cy="14.5" r="1"/><circle cx="16" cy="14.5" r="1"/>',
  users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.7 3 2.4 3.5 5.2"/>',
  wallet:'<rect x="3" y="6" width="18" height="14" rx="2.5"/><path d="M3 10h18M16 15h2"/><path d="M6 6V4.5h11V6"/>',
  chart:'<path d="M5 20V11M11 20V5M17 20v-7M3 20h18"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  cash:'<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5M18 9.5v5"/>',
  print:'<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  download:'<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  alert:'<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
  x:'<path d="M6 6l12 12M18 6 6 18"/>',
  back:'<path d="M15 5l-7 7 7 7"/>',
  edit:'<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  pin:'<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  more:'<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  wheel:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 4v6M5 14l5-1M19 14l-5-1"/>',
  check:'<path d="M5 12.5 10 17 19 7"/>',
  share:'<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.7l7.4-4.3M8.3 13.3l7.4 4.3"/>',
  logout:'<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>'
};
const ic=(n,cls='')=>`<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;
function illus(kind){
  const sky='<rect width="400" height="150" style="fill:var(--ill-sky)"/><circle cx="318" cy="46" r="22" style="fill:var(--ill-sun)"/>';
  let b='';
  if(kind==='lago')b='<path d="M0 96 Q60 70 120 92 T240 88 T400 90 V150 H0Z" style="fill:var(--ill-2)"/><rect y="104" width="400" height="46" style="fill:var(--ill-water)"/><path d="M40 118h70M160 130h90M280 116h60" style="stroke:var(--ill-sky);stroke-width:3;stroke-linecap:round"/>';
  else if(kind==='campo')b='<path d="M0 100 Q100 80 200 98 T400 94 V150 H0Z" style="fill:var(--ill-2)"/><path d="M0 120 Q120 100 240 122 T400 118 V150 H0Z" style="fill:var(--ill-1)"/><rect x="86" y="70" width="6" height="28" style="fill:var(--ill-3)"/><circle cx="89" cy="62" r="16" style="fill:var(--ill-3)"/>';
  else if(kind==='mar')b='<rect y="92" width="400" height="58" style="fill:var(--ill-water)"/><path d="M0 104 q20 -8 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0" style="fill:none;stroke:var(--ill-sky);stroke-width:3"/><path d="M0 132 Q200 112 400 132 V150 H0Z" style="fill:var(--ill-sand)"/>';
  else if(kind==='ciudad')b='<g style="fill:var(--ill-2)"><rect x="30" y="70" width="40" height="80"/><rect x="80" y="50" width="34" height="100"/><rect x="124" y="84" width="50" height="66"/><rect x="236" y="60" width="44" height="90"/><rect x="290" y="78" width="60" height="72"/></g><rect y="130" width="400" height="20" style="fill:var(--ill-1)"/>';
  else b='<path d="M0 120 L70 58 L118 96 L176 40 L246 108 L300 70 L400 118 V150 H0Z" style="fill:var(--ill-2)"/><path d="M0 132 L90 92 L160 124 L232 86 L320 128 L400 104 V150 H0Z" style="fill:var(--ill-1)"/>';
  return `<svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${sky}${b}</svg>`;
}
const tripImage=t=>{const src=photoSrc(t);return src?`<img src="${esc(src)}" alt="Foto de ${esc(t.name)}">`:illus(t.art)};

/* ================= Estado de la pantalla ================= */
const ui={view:'inicio',tripId:null,tab:'resumen',clientId:null,tripFilter:'proximos',clientQ:'',paxQ:'',payFilter:'todos',listOrder:'butaca',listBlocked:true,cajaTrip:'',editLayout:false};
let modal=null;
let dlState=null; // 'yes' | 'no' | null (sin saber)

/* ================= Componentes ================= */
function payPill(r){
  const st=payState(r);
  if(st==='free')return '<span class="pill p-muted">Sin cargo</span>';
  const m={none:['p-none','Sin pagos'],part:['p-part','Pagó una parte'],full:['p-full','Pagado']}[st];
  return `<span class="pill ${m[0]}">${payGlyph(st)}${m[1]}</span>`;
}
function payGlyph(st){
  const inner=st==='none'?'<circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" stroke-width="1.6"/>':st==='part'?'<circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 1.6a4.4 4.4 0 0 1 0 8.8z" fill="currentColor"/>':'<circle cx="6" cy="6" r="5" fill="currentColor"/>';
  return `<svg class="glyph" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">${inner}</svg>`;
}
function dlgHead(title,sub){return `<div class="dlg-head"><div><h2 id="dlg-title">${esc(title)}</h2>${sub?`<p class="muted">${esc(sub)}</p>`:''}</div><button class="x" data-act="close" aria-label="Cerrar">${ic('x')}</button></div>`}
const errSlot='<p class="form-error" id="err" role="alert"></p>';
function counter(label,val,sub,cls){return `<div class="counter ${cls||''}"><b>${val}</b><span>${label}</span>${sub?`<small>${sub}</small>`:''}</div>`}
function legendHTML(){return `<div class="legend" aria-label="Referencias del plano"><span><i class="lg s-free">12</i>Libre</span><span><i class="lg s-taken">MG</i>Ocupada (iniciales)</span><span><i class="lg s-block">${ic('lock')}</i>Bloqueada</span></div>`}
function seatMapHTML(t,o={}){
  const floors=['alta','baja','unica'].filter(f=>t.seats.some(s=>s.floor===f));
  return `<div class="decks">${floors.map(f=>deckHTML(t,f,o)).join('')}</div>`;
}
function deckHTML(t,f,o){
  const seats=t.seats.filter(s=>s.floor===f);
  let maxR=Math.max(0,...seats.map(s=>s.r)),maxC=Math.max(3,...seats.map(s=>s.c));
  if(o.mode==='edit'){maxR+=1;maxC=Math.max(maxC,4)}
  const wideAisle=o.mode==='edit'||seats.some(s=>s.c===2);
  const cols=[];for(let c=0;c<=maxC;c++)cols.push(c===2&&!wideAisle?'26px':'50px');
  const at=new Map(seats.map(s=>[s.r+':'+s.c,s]));
  const cells=[];
  for(let r=0;r<=maxR;r++)for(let c=0;c<=maxC;c++){
    const s=at.get(r+':'+c);
    if(s)cells.push(seatBtn(t,s,o,r,c));
    else if(o.mode==='edit')cells.push(`<button class="seat s-empty" style="grid-row:${r+1};grid-column:${c+1}" data-act="edAdd" data-floor="${f}" data-r="${r}" data-c="${c}" aria-label="Agregar butaca en la fila ${r+1}">+</button>`);
  }
  return `<div class="deck-wrap">${f!=='unica'?`<div class="deck-label">${FLOOR[f]}</div>`:''}<div class="bus"><div class="bus-front">${ic('wheel')}<span>Adelante (chofer)</span></div><div class="deck" style="grid-template-columns:${cols.join(' ')}">${cells.join('')}</div></div></div>`;
}
function seatBtn(t,s,o,r,c){
  const occ=seatOcc(t,s.id),blk=blockOf(t,s.id);
  let cls='seat',inner=`<span>${esc(s.num)}</span>`,label=`Butaca ${s.num}`,dis=false,act;
  if(occ){const cl=clientById(occ.clientId);cls+=' s-taken';inner+=`<small>${esc(initials(cl))}</small>`;label+=`, ocupada por ${nameOf(cl)}`}
  else if(blk){cls+=' s-block';inner+=ic('lock');label+=`, bloqueada: ${blk.reason}`}
  else{cls+=' s-free';label+=', libre'}
  if(o.mode==='pick'){
    act=o.act;
    if(occ||blk){dis=true;cls+=' s-dim'}
    if(o.selected===s.id){cls='seat s-pick';inner=`<span>${esc(s.num)}</span><small>elegida</small>`;label=`Butaca ${s.num}, elegida`}
  }else if(o.mode==='edit')act='edSeat';
  else act='seatInfo';
  return `<button class="${cls}" style="grid-row:${r+1};grid-column:${c+1}" data-act="${act}" data-sid="${s.id}" aria-label="${esc(label)}"${dis?' disabled':''}>${inner}</button>`;
}
function tripCard(t){
  const k=tripCounts(t),m=tripMoney(t),sell=Math.max(1,k.cap-k.blocked),pct=Math.min(100,Math.round(k.seated/sell*100));
  const past=isPast(t);
  return `<article class="trip-card">
    <div class="trip-img">${tripImage(t)}${past?'<span class="pill p-muted">Realizado</span>':''}</div>
    <div class="trip-body">
      <p class="trip-date">${esc(fDate(t.departDate))}${t.departTime?' · '+esc(t.departTime):''}</p>
      <h3><button class="stretch" data-act="openTrip" data-id="${t.id}">${esc(t.name)}</button></h3>
      <p class="muted">${esc([t.city,t.province].filter(Boolean).join(', '))} · ${esc(durationLabel(t))}</p>
      <div class="occ"><div class="occ-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <p class="occ-txt"><b>${k.seated}</b> de ${sell} butacas vendidas · <b>${k.free}</b> ${k.free===1?'libre':'libres'}${k.infants?` · ${plural(k.infants,'bebé','bebés')}`:''}</p></div>
      <p class="trip-money">Cobrado ${money(m.paid)} · Pendiente ${money(m.pending)}</p>
    </div></article>`;
}

/* ================= Navegación ================= */
const NAV=[['inicio','Inicio','home'],['viajes','Viajes','bus'],['clientes','Clientes','users'],['caja','Caja y pagos','wallet'],['reportes','Reportes','chart','Etapa 3'],['config','Configuración','gear']];
function navKey(){return ui.view==='viaje'?'viajes':ui.view==='cliente'?'clientes':ui.view}
function renderNav(){
  const k=navKey();
  $('#nav').innerHTML=NAV.map(([v,l,i,tag])=>`<button data-act="go" data-v="${v}"${k===v?' aria-current="page"':''}>${ic(i)}<span>${l}</span>${tag?`<span class="tag">${tag}</span>`:''}</button>`).join('');
  const mob=[['inicio','Inicio','home'],['viajes','Viajes','bus'],['clientes','Clientes','users'],['caja','Caja','wallet'],['mas','Más','more']];
  const mk=['reportes','config'].includes(k)?'mas':k;
  $('#bottomnav').innerHTML=mob.map(([v,l,i])=>`<button data-act="go" data-v="${v}"${mk===v?' aria-current="page"':''}>${ic(i)}<span>${l}</span></button>`).join('');
  $('#who').textContent=S.user;
  const ws=$('#who-side');if(ws)ws.textContent=S.user;
}
function render(){
  renderNav();
  const views={inicio:viewHome,viajes:viewTrips,viaje:viewTrip,clientes:viewClients,cliente:viewClient,caja:viewCaja,reportes:viewReports,config:viewConfig,mas:viewMore};
  $('#view').innerHTML=(views[ui.view]||viewHome)();
}
function go(v,extra){Object.assign(ui,{view:v},extra||{});if(v!=='viaje')ui.editLayout=false;render();window.scrollTo(0,0)}

/* ================= Vistas ================= */
function computeAlerts(){
  const T=todayISO(),out=[];
  for(const t of upcomingTrips()){
    const act=tripRes(t.id);
    const inc=act.filter(r=>incomplete(clientById(r.clientId)).length);
    if(inc.length)out.push({cls:'',text:`<b>${esc(t.name)}:</b> ${plural(inc.length,'pasajero','pasajeros')} con datos incompletos (${inc.slice(0,3).map(r=>esc(nameOf(clientById(r.clientId)))).join(', ')}${inc.length>3?'…':''}).`,act:`data-act="openTrip" data-id="${t.id}" data-tab="pasajeros"`,btn:'Ver pasajeros'});
    const days=daysBetween(T,t.departDate);
    const owing=act.filter(r=>balanceOf(r)>0);
    if(days<=14&&owing.length){const sum=owing.reduce((s,r)=>s+balanceOf(r),0);out.push({cls:'bad',text:`<b>${esc(t.name)}</b> sale ${days===0?'hoy':days===1?'mañana':`en ${days} días`}: ${plural(owing.length,'pasajero debe','pasajeros deben')} ${money(sum)}.`,act:`data-act="openTrip" data-id="${t.id}" data-tab="pagos"`,btn:'Ver pagos'})}
    if(!t.layoutConfirmed&&days<=30)out.push({cls:'',text:`<b>${esc(t.name)}:</b> el plano de butacas es aproximado. Confirmá los números de las butacas con el micro real.`,act:`data-act="openTrip" data-id="${t.id}" data-tab="butacas"`,btn:'Ver plano'});
    for(const r of act.filter(r=>r.infantOf&&resById(r.infantOf)?.status!=='activa'))out.push({cls:'bad',text:`<b>${esc(nameOf(clientById(r.clientId)))}</b> (bebé) quedó sin adulto asignado en ${esc(t.name)}.`,act:`data-act="openRes" data-id="${r.id}"`,btn:'Resolver'});
  }
  for(const r of S.reservations.filter(r=>r.status==='cancelada'&&r.cancel&&r.cancel.money==='pendiente'))out.push({cls:'bad',text:`<b>${esc(nameOf(clientById(r.clientId)))}:</b> ${money(r.cancel.paid)} de la baja en ${esc(tripById(r.tripId).name)} sin resolver.`,act:`data-act="openRes" data-id="${r.id}"`,btn:'Resolver'});
  const lb=S.lastBackup,since=lb?daysBetween(lb.at.slice(0,10),T):null;
  if(S.reservations.length&&(!lb||since>=7))out.push({cls:'',text:lb?`La última copia de seguridad es de hace ${plural(since,'día','días')} (la descargó ${esc(lb.by)}). Conviene hacer una por semana.`:'Todavía no se descargó ninguna copia de seguridad. Conviene hacer una por semana y guardarla aparte.',act:'data-act="exportExcel"',btn:'Descargar copia'});
  return [...out.filter(a=>a.cls==='bad'),...out.filter(a=>a.cls!=='bad')];
}
function viewHome(){
  const T=todayISO(),up=upcomingTrips(),alerts=computeAlerts();
  let sold=0,paid=0;up.forEach(t=>{const m=tripMoney(t);sold+=m.sold;paid+=m.paid});
  return `<div class="page-head"><div><p class="eyebrow">${esc(cap(fDateLong(T)))}</p><h1>Hola, ${esc(S.user)}</h1></div>
    <div class="head-actions"><button class="btn" data-act="wizard">${ic('plus')}Agregar pasajero</button><button class="btn btn-2" data-act="payFind">${ic('cash')}Registrar pago</button><button class="btn btn-ghost" data-act="tripNew">${ic('bus')}Crear viaje</button></div></div>
  <section><h2>En los próximos viajes</h2><div class="money3"><div><span>Vendido (precios acordados)</span><b>${money(sold)}</b></div><div><span>Cobrado</span><b>${money(paid)}</b></div><div><span>Falta cobrar</span><b>${money(sold-paid)}</b></div></div></section>
  ${alerts.length?`<section><div class="sec-head"><h2>Avisos (${alerts.length})</h2>${alerts.length>3?`<button class="link" data-act="alertsToggle">${ui.allAlerts?'Ver menos':`Ver los ${alerts.length}`}</button>`:''}</div><ul class="alerts">${(ui.allAlerts?alerts:alerts.slice(0,3)).map(a=>`<li class="${a.cls}">${ic('alert')}<p>${a.text}</p><button class="btn btn-ghost btn-sm" ${a.act}>${a.btn}</button></li>`).join('')}</ul></section>`:''}
  <section><div class="sec-head"><h2>Próximos viajes</h2><button class="link" data-act="go" data-v="viajes">Ver todos</button></div>
  ${up.length?`<div class="trip-grid">${up.map(tripCard).join('')}</div>`:'<p class="empty">No hay viajes próximos. Tocá “Crear viaje” para cargar el primero.</p>'}</section>`;
}
function viewTrips(){
  const f=ui.tripFilter;
  let list=[...S.trips];
  if(f==='proximos')list=list.filter(t=>!isPast(t)).sort((a,b)=>a.departDate.localeCompare(b.departDate));
  else if(f==='realizados')list=list.filter(isPast).sort((a,b)=>b.departDate.localeCompare(a.departDate));
  else list.sort((a,b)=>b.departDate.localeCompare(a.departDate));
  return `<div class="page-head"><div><h1>Viajes</h1><p class="muted">Cada salida es un registro propio, aunque se repita el destino.</p></div><div class="head-actions"><button class="btn" data-act="tripNew">${ic('plus')}Crear viaje</button></div></div>
  <div class="chips" role="group" aria-label="Filtrar viajes">${[['proximos','Próximos'],['realizados','Realizados'],['todos','Todos']].map(([k,l])=>`<button class="chip" data-act="tripFilter" data-f="${k}" aria-pressed="${f===k}">${l}</button>`).join('')}</div>
  ${list.length?`<div class="trip-grid">${list.map(tripCard).join('')}</div>`:'<p class="empty">No hay viajes en esta lista.</p>'}`;
}
function viewTrip(){
  const t=tripById(ui.tripId);if(!t){ui.view='viajes';return viewTrips()}
  const k=tripCounts(t),past=isPast(t);
  const tabs=[['resumen','Resumen'],['pasajeros',`Pasajeros (${k.seated+k.infants})`],['butacas','Butacas'],['pagos','Pagos'],['lista','Lista para imprimir']];
  const body={resumen:tabResumen,pasajeros:tabPasajeros,butacas:tabButacas,pagos:tabPagos,lista:tabLista}[ui.tab]||tabResumen;
  return `<div class="crumbs"><button class="link" data-act="go" data-v="viajes">${ic('back')}Viajes</button></div>
  <header class="trip-hero"><div class="hero-img">${tripImage(t)}</div>
    <div class="hero-txt"><p class="eyebrow">${past?'Viaje realizado':'Próxima salida'} · ${esc(fDate(t.departDate))}${t.departTime?' · '+esc(t.departTime):''}</p>
    <h1>${esc(t.name)}</h1>
    <p class="muted">${esc([t.city,t.province].filter(Boolean).join(', '))} · ${esc(durationLabel(t))} · ${esc(VEH[t.vehicle.type])}</p>
    <div class="head-actions"><button class="btn" data-act="wizard" data-trip="${t.id}">${ic('plus')}Agregar pasajero</button><button class="btn btn-ghost" data-act="tripEdit" data-id="${t.id}">${ic('edit')}Editar viaje</button><button class="btn btn-ghost" data-act="tab" data-tab="lista">${ic('print')}Imprimir lista</button></div></div>
  </header>
  <div class="counters">${counter('Capacidad total',k.cap)}${counter('Pasajeros confirmados',k.seated,k.infants?`y ${plural(k.infants,'bebé sin butaca','bebés sin butaca')}`:'')}${counter('Butacas bloqueadas',k.blocked)}${counter('Disponibles para vender',k.free,'','accent')}</div>
  <nav class="tabs" role="tablist" aria-label="Secciones del viaje">${tabs.map(([key,l])=>`<button role="tab" data-act="tab" data-tab="${key}" aria-selected="${ui.tab===key}">${l}</button>`).join('')}</nav>
  ${body(t)}`;
}
function tabResumen(t){
  const m=tripMoney(t);
  const maps=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([t.city,t.province,'Argentina'].filter(Boolean).join(', '))}`;
  const act=tripRes(t.id);
  return `<div class="cols">
   <section class="panel"><h2>Datos del viaje</h2><dl class="dl">
     <dt>Salida</dt><dd>${esc(fDateLong(t.departDate))}${t.departTime?', '+esc(t.departTime):''}</dd>
     <dt>Regreso</dt><dd>${t.returnDate?esc(fDateLong(t.returnDate))+(t.returnTime?', '+esc(t.returnTime):''):'<span class="muted">Sin definir</span>'}</dd>
     <dt>Duración</dt><dd>${esc(durationLabel(t))}</dd>
     <dt>Origen</dt><dd>${esc(t.origin)}</dd>
     <dt>Destino</dt><dd>${esc([t.city,t.province].filter(Boolean).join(', '))}<small><a href="${maps}" target="_blank" rel="noopener">Ver en Google Maps</a></small></dd>
     ${t.hotel?`<dt>Hotel</dt><dd>${esc(t.hotel)}</dd>`:''}
     ${t.meals?`<dt>Comidas</dt><dd>${esc(t.meals)}</dd>`:''}
     ${t.includes?`<dt>Incluye</dt><dd>${esc(t.includes)}</dd>`:''}
     ${t.notes?`<dt>Observaciones</dt><dd>${esc(t.notes)}</dd>`:''}
     <dt>Precio por persona</dt><dd>${money(t.price)}</dd>
   </dl></section>
   <div style="display:flex;flex-direction:column;gap:20px;min-width:0">
     <section class="panel"><h2>Lugares de subida</h2><ul class="plist">${t.pickups.map(p=>{const n=act.filter(r=>r.pickupId===p.pointId).length;return `<li><span><b>${esc(pointName(p.pointId))}</b>${p.time?` · ${esc(p.time)}`:''}</span><span class="muted">${plural(n,'pasajero','pasajeros')}</span></li>`}).join('')}</ul></section>
     <section class="panel"><div class="sec-head"><h2>Cobros</h2><button class="link" data-act="tab" data-tab="pagos">Ver detalle</button></div><dl class="dl"><dt>Vendido</dt><dd>${money(m.sold)}</dd><dt>Cobrado</dt><dd>${money(m.paid)}</dd><dt>Pendiente</dt><dd>${money(m.pending)}</dd></dl></section>
     <section class="panel"><div class="sec-head"><h2>Vehículo</h2><button class="link" data-act="tab" data-tab="butacas">Ver plano</button></div><p>${esc(VEH[t.vehicle.type])} de ${t.seats.length} butacas. ${t.layoutConfirmed?'<span class="pill p-full">Plano confirmado</span>':'<span class="pill p-gold">Plano aproximado</span>'}</p></section>
   </div></div>`;
}
function tabPasajeros(t){
  const canc=tripCancelled(t.id);
  return `<div class="sec-head"><label class="field" style="flex:1 1 280px;max-width:460px"><span class="lbl">Buscar en este viaje</span><input type="search" id="pax-q" value="${esc(ui.paxQ)}" placeholder="Nombre, documento, butaca o subida" autocomplete="off"></label>
    <button class="btn" data-act="wizard" data-trip="${t.id}">${ic('plus')}Agregar pasajero</button></div>
  <div id="pax-list">${paxRows(t)}</div>
  ${canc.length?`<details class="bajas"><summary>Bajas (${canc.length})</summary><div class="rows">${canc.map(r=>{const c=clientById(r.clientId);return `<button class="row" data-act="openRes" data-id="${r.id}"><span class="seatno baby">Baja</span><span class="cell-main"><b>${esc(nameOf(c))}</b><small>${r.cancel?.seatNum?`Tenía la butaca ${esc(r.cancel.seatNum)} · `:''}${esc(fStamp(r.cancel?.at))}${r.cancel?.reason?' · '+esc(r.cancel.reason):''}</small></span><span class="cell-money"><b>${money(r.cancel?.paid||0)}</b><small>pagado</small></span><span class="cell-state">${moneyFate(r)}</span></button>`}).join('')}</div></details>`:''}`;
}
function moneyFate(r){const c=r.cancel;if(!c||!c.paid)return '<span class="pill p-muted">Sin pagos</span>';return {devuelto:'<span class="pill p-muted">Devuelto</span>',saldo:'<span class="pill p-info">Saldo a favor</span>',pendiente:'<span class="pill p-none">Pendiente de resolver</span>'}[c.money]||''}
function paxRows(t){
  const terms=norm(ui.paxQ).split(' ').filter(Boolean);
  const list=tripRes(t.id).filter(r=>{if(!terms.length)return true;const c=clientById(r.clientId);const hay=norm(`${c.firstName} ${c.lastName} ${c.docNumber} ${seatNum(t,r.seatId)} ${pointName(r.pickupId)}`);return terms.every(x=>hay.includes(x))}).sort((a,b)=>resSortKey(t,a)-resSortKey(t,b));
  if(!list.length)return `<p class="empty">${terms.length?'No hay pasajeros que coincidan con la búsqueda.':'Todavía no hay pasajeros. Tocá “Agregar pasajero” para cargar el primero.'}</p>`;
  return `<div class="rows"><div class="row head"><span>Butaca</span><span>Pasajero</span><span class="right">Saldo</span><span class="right">Estado</span></div>${list.map(r=>paxRow(t,r)).join('')}</div>`;
}
function paxRow(t,r){
  const c=clientById(r.clientId),miss=incomplete(c),g=groupOf(r),a=r.infantOf&&resById(r.infantOf);
  return `<button class="row" data-act="openRes" data-id="${r.id}">
    ${r.seatId?`<span class="seatno"><small>Butaca</small>${esc(seatLabel(t,r.seatId))}</span>`:'<span class="seatno baby">Bebé</span>'}
    <span class="cell-main"><b>${esc(nameOf(c))}</b><small>${esc(fDoc(c)||'Sin documento')} · ${esc(pickupLabel(t,r.pickupId))}${a?` · en brazos de ${esc(nameOf(clientById(a.clientId)))}`:''}</small>${miss.length||g?`<span class="chips">${miss.length?`<span class="pill p-warn">${ic('alert')}Falta ${miss.join(' y ')}</span>`:''}${g?`<span class="pill p-info">${esc(g.name)}</span>`:''}</span>`:''}</span>
    <span class="cell-money"><b>${money(balanceOf(r))}</b><small>de ${money(r.price)}</small></span>
    <span class="cell-state">${payPill(r)}</span></button>`;
}
function tabButacas(t){
  const ed=ui.editLayout,inf=tripRes(t.id).filter(r=>!r.seatId);
  return `<div class="layout-head"><div>${t.layoutConfirmed?`<span class="pill p-full">${ic('check')}Plano confirmado</span>`:'<span class="pill p-gold">Plano aproximado</span>'}
    <p class="muted">${t.layoutConfirmed?'Los números coinciden con las butacas del micro real.':'Se armó solo con la cantidad de butacas, así que los números pueden no coincidir con el micro real. Lo importante es el número de cada butaca: cuando sepas cómo están numeradas, tocá «Ajustar plano».'}</p></div>
    <div class="head-actions">${ed?'<button class="btn" data-act="edDone">Terminar ajuste</button>':`<button class="btn btn-ghost" data-act="edStart">${ic('edit')}Ajustar plano</button>`}</div></div>
  ${ed?`<div class="editor-bar"><p><b>Modo ajuste.</b> Tocá una butaca para cambiarle el número o quitarla. Tocá un “+” para agregar una butaca en ese lugar.</p>
    <div class="head-actions"><button class="btn btn-ghost btn-sm" data-act="edRenumber">Numerar de nuevo</button><button class="btn btn-ghost btn-sm" data-act="edModel">Guardar como plano reutilizable</button>
    ${t.layoutConfirmed?'<button class="btn btn-ghost btn-sm" data-act="edConfirm" data-v="0">Volver a aproximado</button>':`<button class="btn btn-2 btn-sm" data-act="edConfirm" data-v="1">${ic('check')}Marcar como confirmado</button>`}</div></div>`:legendHTML()}
  ${seatMapHTML(t,{mode:ed?'edit':'view'})}
  ${inf.length?`<p class="muted">Bebés sin butaca: ${inf.map(r=>{const a=resById(r.infantOf);return `${esc(nameOf(clientById(r.clientId)))}${a&&a.status==='activa'?` (en brazos de ${esc(nameOf(clientById(a.clientId)))}, butaca ${esc(seatLabel(t,a.seatId))})`:''}`}).join(' · ')}</p>`:''}`;
}
function tabPagos(t){
  const act=tripRes(t.id),m=tripMoney(t),f=ui.payFilter;
  const cnt={todos:act.length,none:0,part:0,full:0};act.forEach(r=>{const s=payState(r);cnt[s==='free'?'full':s]++});
  const list=act.filter(r=>{const s=payState(r);return f==='todos'||f===s||(f==='full'&&s==='free')}).sort((a,b)=>resSortKey(t,a)-resSortKey(t,b));
  const movs=movements(t.id);
  const canc=tripCancelled(t.id).filter(r=>r.cancel&&r.cancel.paid>0);
  return `<div class="money3"><div><span>Vendido (precios acordados)</span><b>${money(m.sold)}</b></div><div><span>Cobrado</span><b>${money(m.paid)}</b></div><div><span>Pendiente</span><b>${money(m.pending)}</b></div></div>
  <div class="chips" role="group" aria-label="Filtrar por estado de pago">${[['todos','Todos'],['none','Sin pagos'],['part','Pagó una parte'],['full','Pagado']].map(([k,l])=>`<button class="chip" data-act="payFilter" data-f="${k}" aria-pressed="${f===k}">${k==='todos'?'':payGlyph(k)} ${l} (${cnt[k]})</button>`).join('')}</div>
  ${list.length?`<div class="rows"><div class="row pay-row head"><span>Pasajero</span><span class="right hide-sm">Precio</span><span class="right hide-sm">Abonado</span><span class="right hide-sm">Saldo</span><span class="hide-sm">Estado</span><span></span></div>
  ${list.map(r=>{const c=clientById(r.clientId),p=paidOf(r.id);return `<div class="row pay-row clickable"><span class="cell-main"><button class="link" data-act="openRes" data-id="${r.id}">${esc(nameOf(c))}</button><small>${r.seatId?'Butaca '+esc(seatLabel(t,r.seatId)):'Bebé'}${groupOf(r)?' · '+esc(groupOf(r).name):''}</small></span><span class="right hide-sm">${money(r.price)}</span><span class="right hide-sm">${money(p)}</span><span class="right hide-sm"><b>${money(r.price-p)}</b></span><span class="hide-sm">${payPill(r)}</span><span class="right">${r.price-p>0?`<button class="btn btn-2 btn-sm" data-act="resPay" data-id="${r.id}">Registrar pago</button>`:'<span class="muted small">Sin saldo</span>'}</span></div>`}).join('')}</div>`:'<p class="empty">No hay pasajeros con ese estado de pago.</p>'}
  <section><h3>Movimientos del viaje</h3>${movs.length?`<div class="movs">${movs.map(movRow).join('')}</div>`:'<p class="empty">Todavía no hay pagos registrados.</p>'}</section>
  ${canc.length?`<section><h3>Dinero de bajas</h3><div class="rows">${canc.map(r=>`<button class="row" data-act="openRes" data-id="${r.id}"><span class="seatno baby">Baja</span><span class="cell-main"><b>${esc(nameOf(clientById(r.clientId)))}</b><small>${esc(fStamp(r.cancel.at))}${r.cancel.reason?' · '+esc(r.cancel.reason):''}</small></span><span class="cell-money"><b>${money(r.cancel.paid)}</b><small>pagado</small></span><span class="cell-state">${moneyFate(r)}</span></button>`).join('')}</div><p class="muted small">Lo pagado por las bajas no se cuenta en “Cobrado” de este viaje.</p></section>`:''}`;
}
function movements(tripId){
  const out=[];
  for(const p of S.payments){const rs=p.alloc.map(a=>resById(a.r)).filter(Boolean);const trips=[...new Set(rs.map(r=>r.tripId))];if(tripId&&!trips.includes(tripId))continue;out.push({kind:'pay',p,date:p.date,at:p.createdAt,rs,trips})}
  for(const d of S.refunds){const r=resById(d.resId);if(!r||(tripId&&r.tripId!==tripId))continue;out.push({kind:'ref',d,date:d.date,at:d.at,rs:[r],trips:[r.tripId]})}
  return out.sort((a,b)=>(b.date+b.at).localeCompare(a.date+a.at));
}
function movRow(x){
  const who=x.rs.map(r=>nameOf(clientById(r.clientId))).join(', ');
  const trip=x.trips.map(id=>tripById(id)?.name).filter(Boolean).join(', ');
  if(x.kind==='pay'){const p=x.p,v=p.status!=='valido';
    const title=v?'Pago anulado':p.method===CREDIT?'Pago con saldo a favor':p.alloc.length>1?'Pago de grupo':'Pago';
    return `<button class="mov ${v?'void':''}" data-act="openRes" data-id="${x.rs[0].id}"><span class="m-date">${esc(fDateNum(p.date))}</span><span><b>${title}</b> · ${esc(who)}<small>${esc(trip)} · ${esc(p.method)}${p.note?' · '+esc(p.note):''} · registró ${esc(p.by)}${v?` · anulado: ${esc(p.voidReason)}`:''}</small></span><span class="amt">${money(p.amount)}</span></button>`}
  const d=x.d;
  return `<button class="mov" data-act="openRes" data-id="${x.rs[0].id}"><span class="m-date">${esc(fDateNum(d.date))}</span><span><b>Devolución</b> · ${esc(who)}<small>${esc(trip)} · ${esc(d.method)}${d.note?' · '+esc(d.note):''} · registró ${esc(d.by)}</small></span><span class="amt neg">− ${money(d.amount)}</span></button>`;
}
function listData(t,order,withBlocked){
  const pax=tripRes(t.id).map(r=>{const c=clientById(r.clientId);const a=r.infantOf?resById(r.infantOf):null;const s=r.seatId?seatById(t,r.seatId):null;
    return{kind:'pax',key:resSortKey(t,r),seat:s?seatLabel(t,s.id):'Bebé',name:listName(c),note:a&&a.status==='activa'?`bebé en brazos de ${nameOf(clientById(a.clientId))}`:'',doc:docShort(c),birth:c.birthDate?fDateNum(c.birthDate):'',pickupId:r.pickupId,pickup:pickupLabel(t,r.pickupId),missing:incomplete(c).length>0}});
  const blk=withBlocked?t.blocks.map(b=>({kind:'blk',key:numKey(seatById(t,b.seatId)),seat:seatLabel(t,b.seatId),name:b.name?`${b.name} (${b.reason})`:b.reason,note:'Butaca bloqueada',doc:'',birth:'',pickup:''})):[];
  let rows;
  if(order==='subida'){
    rows=[];
    for(const p of t.pickups){const l=pax.filter(x=>x.pickupId===p.pointId).sort((a,b)=>a.key-b.key);if(!l.length)continue;rows.push({kind:'grp',label:`${pointName(p.pointId)}${p.time?' · '+p.time:''} · ${plural(l.length,'pasajero','pasajeros')}`});rows.push(...l)}
    const orphan=pax.filter(x=>!pickupOf(t,x.pickupId));if(orphan.length){rows.push({kind:'grp',label:'Sin lugar de subida'});rows.push(...orphan)}
    if(blk.length){rows.push({kind:'grp',label:'Butacas bloqueadas'});rows.push(...blk.sort((a,b)=>a.key-b.key))}
  }else rows=[...pax,...blk].sort((a,b)=>a.key-b.key);
  let n=0;rows.forEach(r=>{if(r.kind==='pax')r.n=++n});
  return rows;
}
function nowHuman(){const d=new Date();return `${fDateNum(isoOf(d))} a las ${pad(d.getHours())}:${pad(d.getMinutes())}`}
function sheetHTML(t){
  const rows=listData(t,ui.listOrder,ui.listBlocked),k=tripCounts(t);
  return `<div class="sheet"><div class="sheet-head"><div class="sheet-brand"><img class="sheet-logo" src="img/logo-192.png" alt=""><div><b>Nieves Viajes</b><span class="sheet-kind">Lista de pasajeros</span></div></div><div class="sheet-meta">Lista generada el ${esc(nowHuman())}</div></div>
  <p class="sheet-title">${esc(t.name)}</p>
  <p class="sheet-sub">Destino: ${esc([t.city,t.province].filter(Boolean).join(', '))} · Salida: ${esc(fDateLong(t.departDate))}${t.departTime?', '+esc(t.departTime):''} · ${esc(VEH[t.vehicle.type])} de ${t.seats.length} butacas</p>
  <div class="sheet-scroll"><table class="sheet-table"><thead><tr><th>N°</th><th>Butaca</th><th>Apellido y nombre</th><th>Documento</th><th>Nacimiento</th><th>Subida</th></tr></thead><tbody>
  ${rows.map(r=>r.kind==='grp'?`<tr class="grp"><td colspan="6">${esc(r.label)}</td></tr>`:`<tr class="${r.kind==='blk'?'blk':''}"><td class="n">${r.n||''}</td><td class="seat-c">${esc(r.seat)}</td><td>${esc(r.name)}${r.note?`<small>${esc(r.note)}</small>`:''}</td><td>${esc(r.doc)}</td><td>${esc(r.birth)}</td><td>${esc(r.pickup)}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="sheet-foot"><span>Total: ${plural(k.seated+k.infants,'pasajero','pasajeros')} (${k.seated} con butaca${k.infants?`, ${plural(k.infants,'bebé','bebés')} sin butaca`:''})</span><span>Butacas bloqueadas: ${k.blocked}</span></div></div>`;
}
function tabLista(t){
  const miss=tripRes(t.id).filter(r=>incomplete(clientById(r.clientId)).length);
  const framed=isFramed();
  const canPdf=!framed||dlState==='yes';
  if(canPdf)ensurePdf().catch(()=>{});
  const share=!framed&&canShareFiles();
  return `<div class="list-tools"><div class="chips" role="group" aria-label="Orden de la lista"><span class="lbl">Ordenar por</span>${[['butaca','Número de butaca'],['subida','Lugar de subida']].map(([k,l])=>`<button class="chip" data-act="listOrder" data-o="${k}" aria-pressed="${ui.listOrder===k}">${l}</button>`).join('')}</div>
    <label class="check"><input type="checkbox" id="list-blocked" ${ui.listBlocked?'checked':''}> Mostrar butacas bloqueadas</label>
    <div class="head-actions">${framed?'':`<button class="btn" data-act="print">${ic('print')}Imprimir</button>`}${canPdf?`<button class="btn ${framed?'':'btn-2'}" data-act="pdf">${share?ic('share')+'Compartir PDF':ic('download')+'Descargar PDF'}</button>`:''}</div></div>
  ${framed?`<p class="note">${dlState==='yes'?'En esta vista no se puede abrir la impresora: descargá el PDF y imprimilo desde ahí.':'En esta vista no se puede imprimir ni descargar. Abrí la app en su dirección propia.'}</p>`:''}${share?'<p class="muted small">«Compartir PDF» abre el menú del celular: podés mandarlo por WhatsApp al chofer, guardarlo o imprimirlo.</p>':''}
  ${miss.length?`<div class="warnbox">${ic('alert')}<p><b>${plural(miss.length,'pasajero tiene','pasajeros tienen')} datos incompletos:</b> ${miss.map(r=>esc(nameOf(clientById(r.clientId)))).join(', ')}. En la lista quedan los espacios en blanco para completar a mano, o podés completarlos antes de imprimir.</p></div>`:''}
  <p class="muted small">La lista del chofer muestra solo datos de pasajeros y embarque: no incluye pagos, saldos ni observaciones privadas.</p>
  <div class="sheet-wrap">${sheetHTML(t)}</div>`;
}
function viewClients(){
  return `<div class="page-head"><div><h1>Clientes</h1><p class="muted">Los datos se cargan una vez y se reutilizan en cada viaje.</p></div><div class="head-actions"><button class="btn" data-act="clientNew">${ic('plus')}Crear cliente</button></div></div>
  <label class="field" style="max-width:480px"><span class="lbl">Buscar por nombre o documento</span><input type="search" id="client-q" value="${esc(ui.clientQ)}" placeholder="Ej: Gómez o 90237911" autocomplete="off"></label>
  <div id="client-list">${clientRows()}</div>`;
}
function clientMatch(c,q){const t=norm(q),dq=digits(q);if(!t)return true;const hay=norm(`${c.firstName} ${c.lastName}`);return (dq.length>=3&&digits(c.docNumber).includes(dq))||t.split(' ').every(x=>hay.includes(x))||(c.docType==='Pasaporte'&&norm(c.docNumber).includes(t))}
function clientRows(){
  const T=todayISO();
  const list=S.clients.filter(c=>clientMatch(c,ui.clientQ)).sort((a,b)=>norm(a.lastName+' '+a.firstName).localeCompare(norm(b.lastName+' '+b.firstName)));
  if(!list.length)return '<p class="empty">No hay clientes que coincidan.</p>';
  return `<div class="rows"><div class="row client-row head"><span>Cliente</span><span class="hide-sm">Teléfono</span><span class="hide-sm">Viajes realizados</span><span class="right">Próximo viaje</span></div>${list.map(c=>{
    const next=S.reservations.filter(r=>r.clientId===c.id&&r.status==='activa').map(r=>tripById(r.tripId)).filter(t=>tripEnd(t)>=T).sort((a,b)=>a.departDate.localeCompare(b.departDate))[0];
    const cr=clientCreditLeft(c.id),miss=incomplete(c);
    return `<button class="row client-row" data-act="openClient" data-id="${c.id}"><span class="cell-main"><b>${esc(listName(c))}</b><small>${esc(fDoc(c)||'Sin documento')}</small>${miss.length||cr>0?`<span class="chips">${miss.length?`<span class="pill p-warn">Falta ${miss.join(' y ')}</span>`:''}${cr>0?`<span class="pill p-info">Saldo a favor ${money(cr)}</span>`:''}</span>`:''}</span><span class="hide-sm">${esc(c.phone||'—')}</span><span class="hide-sm">${doneCount(c.id)}</span><span class="right small">${next?esc(next.name)+'<br><span class="muted">'+esc(fDate(next.departDate))+'</span>':'<span class="muted">—</span>'}</span></button>`}).join('')}</div>`;
}
function viewClient(){
  const c=clientById(ui.clientId);if(!c){ui.view='clientes';return viewClients()}
  const T=todayISO(),res=S.reservations.filter(r=>r.clientId===c.id);
  const byDate=(a,b)=>tripById(a.tripId).departDate.localeCompare(tripById(b.tripId).departDate);
  const up=res.filter(r=>r.status==='activa'&&tripEnd(tripById(r.tripId))>=T).sort(byDate);
  const done=res.filter(r=>r.status==='activa'&&tripEnd(tripById(r.tripId))<T).sort(byDate).reverse();
  const canc=res.filter(r=>r.status==='cancelada');
  const credits=clientCredits(c.id),cr=clientCreditLeft(c.id),miss=incomplete(c),age=ageOf(c.birthDate);
  return `<div class="crumbs"><button class="link" data-act="go" data-v="clientes">${ic('back')}Clientes</button></div>
  <div class="page-head"><div><p class="eyebrow">Ficha de cliente</p><h1>${esc(nameOf(c))}</h1><p class="muted">${esc(fDoc(c)||'Sin documento cargado')}${c.birthDate?` · nació el ${esc(fDateNum(c.birthDate))} (${age<1?'menos de 1 año':age+' años'})`:''}</p></div>
  <div class="head-actions"><button class="btn btn-ghost" data-act="clientEdit" data-id="${c.id}">${ic('edit')}Editar datos</button></div></div>
  ${miss.length?`<div class="warnbox">${ic('alert')}<p><b>Faltan datos:</b> ${miss.join(' y ')}. Hacen falta para la lista del chofer.</p></div>`:''}
  <div class="counters">${counter('Viajes realizados',done.length)}${counter('Próximas reservas',up.length)}${counter('Reservas canceladas',canc.length)}${counter('Saldo a favor',money(cr),'',cr>0?'accent':'')}</div>
  <div class="cols"><section class="panel"><h2>Datos personales</h2><dl class="dl">
    <dt>Documento</dt><dd>${esc(fDoc(c)||'—')}</dd><dt>Nacimiento</dt><dd>${c.birthDate?esc(fDateNum(c.birthDate)):'—'}</dd><dt>Teléfono</dt><dd>${esc(c.phone||'—')}</dd>
    <dt>Emergencia</dt><dd>${esc([c.emergencyName,c.emergencyPhone].filter(Boolean).join(' · ')||'—')}</dd>
    <dt>Observaciones</dt><dd>${esc(c.notes||'—')}<small>Privadas: no salen en la lista del chofer.</small></dd></dl></section>
  <section class="panel"><h2>Saldo a favor</h2>${credits.length?`<ul class="plist">${credits.map(x=>{const o=resById(x.originRes);const uses=S.payments.filter(p=>p.status==='valido'&&p.creditUses&&p.creditUses.some(u=>u.c===x.id));return `<li style="flex-direction:column;gap:4px"><span><b>${money(x.amount)}</b> de la baja en ${esc(o?tripById(o.tripId).name:'—')} (${esc(fStamp(x.at))})</span>${uses.map(p=>{const u=p.creditUses.find(u=>u.c===x.id);const r=resById(p.alloc[0].r);return `<span class="muted small">Usado ${money(u.amt)} el ${esc(fDateNum(p.date))} en ${esc(tripById(r.tripId).name)}</span>`}).join('')}<span class="small">Disponible: <b>${money(creditLeft(x))}</b></span></li>`}).join('')}</ul>`:'<p class="muted">No tiene saldo a favor.</p>'}</section></div>
  <section><h2>Próximas reservas</h2>${resCards(up)}</section>
  <section><h2>Viajes realizados</h2>${resCards(done)}</section>
  <section><h2>Reservas canceladas</h2>${resCards(canc)}</section>`;
}
function resCards(list){
  if(!list.length)return '<p class="empty">Ninguna.</p>';
  return `<div class="rows">${list.map(r=>{const t=tripById(r.tripId),p=paidOf(r.id);
    return `<button class="row" data-act="openRes" data-id="${r.id}"><span class="seatno ${r.seatId?'':'baby'}">${r.seatId?`<small>Butaca</small>${esc(seatLabel(t,r.seatId))}`:r.status==='cancelada'?'Baja':'Bebé'}</span><span class="cell-main"><b>${esc(t.name)}</b><small>${esc(cap(fDateLong(t.departDate)))} · ${esc(pickupLabel(t,r.pickupId))}</small></span>
    <span class="cell-money"><b>${money(r.price)}</b><small>abonado ${money(p)}${r.status==='activa'?` · saldo ${money(r.price-p)}`:''}</small></span><span class="cell-state">${r.status==='activa'?payPill(r):moneyFate(r)}</span></button>`}).join('')}</div>`;
}
function viewCaja(){
  const tid=ui.cajaTrip,movs=movements(tid||null);
  const valid=movs.filter(x=>x.kind==='pay'&&x.p.status==='valido');
  const byMethod={};let cash=0,credit=0;
  valid.forEach(x=>{if(x.p.method===CREDIT){credit+=x.p.amount;return}cash+=x.p.amount;byMethod[x.p.method]=(byMethod[x.p.method]||0)+x.p.amount});
  const refunds=movs.filter(x=>x.kind==='ref').reduce((s,x)=>s+x.d.amount,0);
  return `<div class="page-head"><div><h1>Caja y pagos</h1><p class="muted">Registro de cobros y devoluciones. Anotar un pago no cobra nada: solo lo registra.</p></div><div class="head-actions"><button class="btn" data-act="payFind">${ic('cash')}Registrar pago</button></div></div>
  <label class="field" style="max-width:420px"><span class="lbl">Viaje</span><select id="caja-trip"><option value="">Todos los viajes</option>${[...S.trips].sort((a,b)=>b.departDate.localeCompare(a.departDate)).map(t=>`<option value="${t.id}"${tid===t.id?' selected':''}>${esc(t.name)} · ${esc(fDateNum(t.departDate))}</option>`).join('')}</select></label>
  <div class="money3"><div><span>Dinero recibido</span><b>${money(cash)}</b><span>${Object.entries(byMethod).map(([k,v])=>`${esc(k)}: ${money(v)}`).join(' · ')||'Sin pagos'}</span></div><div><span>Devoluciones</span><b>${money(refunds)}</b></div><div><span>Pagado con saldo a favor</span><b>${money(credit)}</b><span>No es dinero nuevo: viene de bajas anteriores.</span></div></div>
  <section><h2>Movimientos</h2>${movs.length?`<div class="movs">${movs.map(movRow).join('')}</div>`:'<p class="empty">No hay movimientos.</p>'}</section>`;
}
function viewReports(){
  return `<div class="page-head"><div><h1>Reportes</h1></div></div>
  <section class="panel"><span class="pill p-gold" style="align-self:flex-start">Etapa 3</span><h2>Resultados por viaje y por mes</h2>
  <p>Acá vas a ver, separado y con nombres claros: lo <b>vendido</b> (precios acordados), lo <b>cobrado</b> (dinero recibido), lo <b>pendiente</b>, los <b>gastos</b> de cada viaje (micro, hotel, comidas y otros) y el <b>resultado estimado</b> cuando haya datos de gastos.</p>
  <p class="muted">Mientras tanto, cada viaje muestra vendido, cobrado y pendiente en su pestaña Pagos.</p></section>`;
}
function viewConfig(){
  return `<div class="page-head"><div><h1>Configuración</h1></div></div>
  <section class="panel"><div class="sec-head"><h2>Lugares de subida</h2><button class="btn btn-2 btn-sm" data-act="pointNew">${ic('plus')}Agregar lugar</button></div>
    <div class="rows">${S.points.map(p=>`<button class="row point-row" data-act="pointEdit" data-id="${p.id}"><span class="cell-main"><b>${esc(p.name)}</b><small>${esc([p.address,p.reference].filter(Boolean).join(' · ')||'Sin dirección cargada')}</small></span><span class="muted small">${plural(usedPoint(p.id),'viaje','viajes')}</span></button>`).join('')}</div>
    <p class="muted small">El horario de cada lugar se indica en cada viaje, porque cambia según la salida. El precio es el mismo suba donde suba.</p></section>
  <section class="panel"><h2>Medios de pago</h2><div class="chips">${S.methods.map(m=>`<span class="pill p-muted" style="font-size:15px;padding:6px 6px 6px 12px">${esc(m)}<button class="x" style="padding:2px;margin:0" data-act="methodRemove" data-m="${esc(m)}" aria-label="Quitar ${esc(m)}">${ic('x')}</button></span>`).join('')}</div>
    <div class="head-actions"><input type="text" id="method-new" placeholder="Ej: Tarjeta de débito" style="max-width:280px"><button class="btn btn-ghost btn-sm" data-act="methodAdd">Agregar</button></div>
    <p class="muted small">“Saldo a favor” aparece solo cuando el cliente tiene saldo de una baja.</p></section>
  <section class="panel"><h2>Planos guardados</h2>${S.models.length?`<div class="rows">${S.models.map(m=>`<div class="row point-row"><span class="cell-main"><b>${esc(m.name)}</b><small>${esc(VEH[m.type])} · ${m.seats.length} butacas</small></span><button class="btn btn-ghost btn-sm" data-act="modelDelete" data-id="${m.id}">Borrar</button></div>`).join('')}</div>`:'<p class="muted">Todavía no hay planos guardados. En un viaje, entrá a Butacas › Ajustar plano › Guardar como plano reutilizable.</p>'}</section>
  <section class="panel"><h2>Copia de seguridad</h2><p>Los datos se guardan en internet y se comparten entre los dos usuarios. Igual conviene descargar una copia una vez por semana y guardarla aparte (en el mail o en un pendrive).</p>
    <p class="small">${S.lastBackup?`Última copia: <b>${esc(fStamp(S.lastBackup.at))}</b>, la descargó ${esc(S.lastBackup.by)}.`:'Todavía no se descargó ninguna copia.'}</p>
    <div class="head-actions"><button class="btn btn-2" data-act="exportExcel">${ic('download')}Descargar copia en Excel</button><button class="btn btn-ghost" data-act="exportJson">Copia completa (archivo técnico)</button></div>
    <p class="muted small">El Excel se abre con cualquier planilla y trae clientes, viajes, reservas, pagos, devoluciones y saldos a favor. La copia completa sirve para recuperar todo si algún día hiciera falta.</p></section>
  <section class="panel"><h2>Tu sesión</h2><p>Entraste como <b>${esc(S.user)}</b>. Todo lo que cargás queda registrado con tu nombre.</p><div class="head-actions"><button class="btn btn-ghost" data-act="passNew">Cambiar mi contraseña</button><button class="btn btn-ghost" data-act="logout">${ic('logout')}Salir</button></div><p class="muted small">En una computadora que no es tuya, tocá Salir al terminar.</p></section>`;
}
function viewMore(){
  return `<div class="page-head"><div><h1>Más</h1></div></div>
  <div class="rows"><button class="row point-row" data-act="go" data-v="reportes"><span class="cell-main"><b>Reportes</b><small>Llega en la etapa 3</small></span>${ic('chart')}</button><button class="row point-row" data-act="go" data-v="config"><span class="cell-main"><b>Configuración</b><small>Lugares de subida, medios de pago, planos y copia de seguridad</small></span>${ic('gear')}</button></div>
  <section class="panel"><h2>Tu sesión</h2><p>Entraste como <b>${esc(S.user)}</b>.</p><div><button class="btn btn-ghost" data-act="logout">${ic('logout')}Salir</button></div></section>`;
}

/* ================= Diálogos ================= */
function openModal(m){modal=m;renderModal()}
function closeModal(){modal=null;$('#modal').innerHTML=''}
function renderModal(){
  if(!modal){$('#modal').innerHTML='';return}
  const fn=MODALS[modal.type];if(!fn){closeModal();return}
  const html=fn(modal);
  const prev=$('#modal .dlg-body');const keepScroll=prev&&modal._keep?prev.scrollTop:0;modal._keep=false;
  $('#modal').innerHTML=`<div class="overlay"><div class="dialog ${modal.wide?'wide':''}" role="dialog" aria-modal="true" aria-labelledby="dlg-title">${html}</div></div>`;
  if(keepScroll){const b=$('#modal .dlg-body');if(b)b.scrollTop=keepScroll}
  if(window.innerWidth>=900){const af=$('#modal [autofocus]');if(af)af.focus({preventScroll:true})}
}
function rerender(){if(modal)modal._keep=true;renderModal()}
function mFile(m){return dlgHead('Archivo listo',m.file.name)+`<div class="dlg-body"><p>Tocá <b>Compartir</b> para mandarlo por WhatsApp, guardarlo en el celular o imprimirlo.</p>${errSlot}</div><div class="dlg-foot"><button class="btn btn-ghost" data-act="saveFile">Descargar</button><button class="btn" data-act="shareFile">${ic('share')}Compartir</button></div>`}
function mPass(m){return dlgHead('Cambiar mi contraseña',S.user)+`<div class="dlg-body"><div class="fgrid"><label class="field full"><span>Contraseña nueva</span><input type="password" id="pw-1" autocomplete="new-password" autofocus><small>Al menos 8 letras o números. Anotala en un lugar seguro.</small></label><label class="field full"><span>Repetila</span><input type="password" id="pw-2" autocomplete="new-password"></label></div><label class="check"><input type="checkbox" id="pw-show"> Mostrar</label>${errSlot}</div><div class="dlg-foot"><button class="btn btn-ghost" data-act="close">Cancelar</button><button class="btn" data-act="passDo">Guardar contraseña</button></div>`}
const MODALS={file:mFile,pass:mPass,wiz:mWiz,trip:mTrip,client:mClient,res:mRes,seat:mSeat,payFind:mPayFind,done:mDone,confirm:mConfirm,point:mPoint,edSeat:mEdSeat,edAdd:mEdAdd,edRenumber:mEdRenumber,edModel:mEdModel};

function mConfirm(m){return dlgHead(m.title)+`<div class="dlg-body"><p>${m.text}</p>${errSlot}</div><div class="dlg-foot"><button class="btn btn-ghost" data-act="close">Cancelar</button><button class="btn ${m.danger?'btn-danger':''}" data-act="confirmOk">${esc(m.ok)}</button></div>`}
function confirmBox(title,text,ok,onOk,danger){openModal({type:'confirm',title,text,ok,onOk,danger})}

/* ---- Cliente (formulario) ---- */
function clientFields(p,c){
  c=c||{};const pas=c.docType==='Pasaporte';
  return `<div class="fblock"><h3>Datos personales</h3><div class="fgrid">
    <label class="field"><span>Nombre</span><input type="text" id="${p}-fn" value="${esc(c.firstName)}" autocomplete="off" autofocus></label>
    <label class="field"><span>Apellido</span><input type="text" id="${p}-ln" value="${esc(c.lastName)}" autocomplete="off"></label>
    <label class="field"><span>Fecha de nacimiento</span><input type="date" id="${p}-birth" value="${esc(c.birthDate)}" max="${todayISO()}"><small>Necesaria para la lista del chofer.</small></label></div></div>
  <div class="fblock"><h3>Documento</h3><div class="fgrid">
    <label class="field"><span>Tipo</span><select id="${p}-dtype"><option${pas?'':' selected'}>DNI</option><option${pas?' selected':''}>Pasaporte</option></select></label>
    <label class="field"><span>Número</span><input type="text" id="${p}-dnum" value="${esc(c.docNumber)}" inputmode="${pas?'text':'numeric'}" autocomplete="off"><small>Se usa para no cargar dos veces a la misma persona.</small></label>
    <label class="field" id="${p}-dcountry-wrap"${pas?'':' hidden'}><span>País que lo emitió</span><input type="text" id="${p}-dcountry" value="${esc(c.docCountry)}" placeholder="Ej: Uruguay"></label></div></div>
  <div class="fblock"><h3>Contacto</h3><div class="fgrid">
    <label class="field"><span>Teléfono</span><input type="tel" id="${p}-phone" value="${esc(c.phone)}"></label>
    <label class="field"><span>Contacto de emergencia (opcional)</span><input type="text" id="${p}-ename" value="${esc(c.emergencyName)}" placeholder="Nombre y relación"></label>
    <label class="field"><span>Teléfono de emergencia</span><input type="tel" id="${p}-ephone" value="${esc(c.emergencyPhone)}"></label></div></div>
  <div class="fblock"><h3>Observaciones (opcional)</h3><label class="field"><span>Alimentación, movilidad u otros</span><textarea id="${p}-notes">${esc(c.notes)}</textarea><small>Son privadas: no salen en la lista del chofer.</small></label></div>`;
}
function readClient(p){const v=id=>($('#'+p+'-'+id)||{}).value||'';return{firstName:v('fn'),lastName:v('ln'),birthDate:v('birth'),docType:v('dtype'),docNumber:v('dnum'),docCountry:v('dcountry'),phone:v('phone'),emergencyName:v('ename'),emergencyPhone:v('ephone'),notes:v('notes')}}
function mClient(m){const c=m.id?clientById(m.id):null;
  return dlgHead(c?'Editar cliente':'Crear cliente',c?nameOf(c):'')+`<div class="dlg-body">${clientFields('cf',c)}${errSlot}</div><div class="dlg-foot"><button class="btn btn-ghost" data-act="close">Cancelar</button><button class="btn" data-act="clientSave">${c?'Guardar cambios':'Guardar cliente'}</button></div>`}

/* ---- Viaje (formulario) ---- */
function pkRow(pid,checked,time){return `<div class="pk-row"><label class="choice"><input type="checkbox" data-pk="${pid}"${checked?' checked':''}><span><b>${esc(pointName(pid))}</b>${pointById(pid)?.address?`<br><small class="muted">${esc(pointById(pid).address)}</small>`:''}</span></label><input type="time" data-pkt="${pid}" value="${esc(time||'')}" aria-label="Horario en ${esc(pointName(pid))}"></div>`}
function mTrip(m){
  const t=m.id?tripById(m.id):null;
  const v=t||{name:'',origin:'Rosario',province:'Córdoba',city:'',departDate:'',departTime:'07:00',returnDate:'',returnTime:'',hotel:'',meals:'',includes:'',notes:'',price:'',art:'sierras',pickups:[],vehicle:{type:'micro1'},seats:[]};
  const type=v.vehicle.type,cap=t?t.seats.length:60,lower=t?(t.seats.filter(s=>s.floor==='baja').length||10):10;
  const hasPhoto=m.photo!==undefined?!!m.photo:!!(t&&t.photo);
  const photo=m.photo!==undefined?(m.photo?(photoUrls[m.photo]||m.photo):null):photoSrc(t);
  const multi=v.returnDate&&v.returnDate!==v.departDate;
  return dlgHead(t?'Editar viaje':'Crear viaje',t?t.name:'Cada salida es un registro propio')+`<div class="dlg-body">
  <div class="fblock"><h3>Destino y fechas</h3><div class="fgrid">
    <label class="field full"><span>Nombre del viaje</span><input type="text" id="tf-name" value="${esc(v.name)}" placeholder="Ej: Miramar de Ansenuza" autofocus></label>
    <label class="field"><span>Provincia</span><select id="tf-prov">${PROV.map(p=>`<option${p===v.province?' selected':''}>${p}</option>`).join('')}</select></label>
    <label class="field"><span>Ciudad</span><input type="text" id="tf-city" value="${esc(v.city)}" placeholder="Ej: Miramar de Ansenuza"></label>
    <label class="field"><span>Fecha de salida</span><input type="date" id="tf-dd" value="${esc(v.departDate)}"></label>
    <label class="field"><span>Hora de salida</span><input type="time" id="tf-dt" value="${esc(v.departTime)}"></label>
    <label class="field"><span>Fecha de regreso (si ya se sabe)</span><input type="date" id="tf-rd" value="${esc(v.returnDate)}"><small id="tf-dur">${esc(t?durationLabel(t):'Si vuelve el mismo día, dejala vacía.')}</small></label>
    <label class="field"><span>Hora de regreso</span><input type="time" id="tf-rt" value="${esc(v.returnTime)}"></label>
    <label class="field"><span>Origen</span><input type="text" id="tf-origin" value="${esc(v.origin)}"></label></div></div>
  <div class="fblock"><h3>Transporte</h3>
    <div class="choices" role="radiogroup" aria-label="Tipo de vehículo">${Object.entries(VEH).map(([k,l])=>`<label class="choice"><input type="radio" name="tf-type" value="${k}"${type===k?' checked':''}><span><b>${l}</b></span></label>`).join('')}</div>
    <div class="fgrid"><label class="field"><span>¿Cuántas butacas tiene?</span><input type="number" id="tf-cap" min="1" max="99" value="${cap}"></label>
    <label class="field" id="tf-lower-wrap"${type==='micro2'?'':' hidden'}><span>Butacas en planta baja</span><input type="number" id="tf-lower" min="1" max="98" value="${lower}"></label>
    ${S.models.length?`<label class="field full"><span>O usá un plano guardado</span><select id="tf-model"><option value="">No, armar uno aproximado</option>${S.models.map(x=>`<option value="${x.id}">${esc(x.name)} (${x.seats.length} butacas)</option>`).join('')}</select></label>`:''}</div>
    ${t?'<p class="muted small">Si cambiás el tipo o la cantidad de butacas, el plano se vuelve a armar y cada pasajero conserva su número de butaca.</p>':''}</div>
  <div class="fblock"><h3>Lugares de subida</h3><p class="muted small">Marcá dónde sube gente en esta salida y el horario de cada lugar.</p>
    <div class="choices" id="tf-pickups">${S.points.map(p=>{const tp=v.pickups.find(x=>x.pointId===p.id);return pkRow(p.id,!!tp,tp?tp.time:'')}).join('')}</div>
    <div><button class="btn btn-ghost btn-sm" data-act="tfNewPoint">${ic('plus')}Agregar lugar nuevo</button></div>
    <div class="newpoint" id="tf-np" hidden><div class="fgrid"><label class="field"><span>Nombre</span><input type="text" id="tf-np-name" placeholder="Ej: Funes"></label><label class="field"><span>Dirección</span><input type="text" id="tf-np-addr"></label><label class="field full"><span>Referencia</span><input type="text" id="tf-np-ref" placeholder="Ej: frente a la estación de servicio"></label></div><div><button class="btn btn-2 btn-sm" data-act="tfSavePoint">Guardar lugar</button></div></div></div>
  <div class="fblock"><h3>Precio</h3><div class="fgrid"><label class="field"><span>Precio general por persona</span><input type="text" id="tf-price" inputmode="numeric" value="${v.price===''?'':esc(NUM.format(v.price))}" placeholder="Ej: 250.000"><small>Se aplica solo al agregar pasajeros. Igual para todos los lugares de subida.</small></label></div>
    ${t?`<label class="choice" id="tf-apply-wrap" hidden><input type="checkbox" id="tf-apply"><span>Aplicar el precio nuevo también a las reservas que tienen el precio anterior (${money(t.price)}). Si no lo marcás, las reservas existentes conservan su precio.</span></label>`:''}</div>
  <details class="more"${multi||v.hotel?' open':''}><summary>Hotel y servicios (opcional)</summary><div class="fgrid">
    <label class="field full"><span>Hotel</span><input type="text" id="tf-hotel" value="${esc(v.hotel)}" placeholder="Para salidas de un día, dejalo vacío"></label>
    <label class="field full"><span>Régimen de comidas</span><input type="text" id="tf-meals" value="${esc(v.meals)}" placeholder="Ej: desayuno y cena"></label>
    <label class="field full"><span>Qué incluye</span><textarea id="tf-includes">${esc(v.includes)}</textarea></label>
    <label class="field full"><span>Observaciones</span><textarea id="tf-notes">${esc(v.notes)}</textarea></label></div></details>
  <div class="fblock"><h3>Foto del destino (opcional)</h3>
    <div class="photo-prev" id="tf-prev">${photo?`<img src="${esc(photo)}" alt="Foto elegida">`:illus(v.art)}</div>
    <div class="head-actions"><label class="btn btn-ghost btn-sm" for="tf-photo">${hasPhoto?'Cambiar foto':'Cargar foto'}</label><input type="file" id="tf-photo" accept="image/*" hidden>${hasPhoto?'<button class="btn btn-ghost btn-sm" data-act="tfPhotoClear">Quitar foto</button>':''}</div>
    <label class="field" style="max-width:300px"><span>Dibujo si no hay foto</span><select id="tf-art">${Object.entries(ARTS).map(([k,l])=>`<option value="${k}"${v.art===k?' selected':''}>${l}</option>`).join('')}</select></label></div>
  ${errSlot}</div>
  <div class="dlg-foot"><button class="btn btn-ghost" data-act="close">Cancelar</button><button class="btn" data-act="tripSave">${t?'Guardar cambios':'Crear viaje'}</button></div>`;
}
function readTrip(){
  const v=id=>($('#'+id)||{}).value||'';
  const pickups=$$('[data-pk]').filter(x=>x.checked).map(x=>({pointId:x.dataset.pk,time:($(`[data-pkt="${x.dataset.pk}"]`)||{}).value||''}));
  return{name:v('tf-name'),province:v('tf-prov'),city:v('tf-city'),departDate:v('tf-dd'),departTime:v('tf-dt'),returnDate:v('tf-rd'),returnTime:v('tf-rt'),origin:v('tf-origin'),type:($('input[name="tf-type"]:checked')||{}).value,capacity:v('tf-cap'),lower:v('tf-lower'),modelId:v('tf-model'),pickups,price:v('tf-price'),applyPrice:!!($('#tf-apply')||{}).checked,hotel:v('tf-hotel'),meals:v('tf-meals'),includes:v('tf-includes'),notes:v('tf-notes'),art:v('tf-art'),photo:modal.photo};
}

/* ---- Agregar pasajero (pasos) ---- */
function openWizard(tripId,seatId){
  const t=tripId?tripById(tripId):null;
  const m={type:'wiz',wide:true,tripId:t?t.id:null,step:t?1:0,q:'',clientId:null,creating:false,pickupId:'',mode:'seat',seatId:seatId||'',infantOf:'',groupWith:'',price:'',priceTouched:false,reason:'',reasonText:'',dep:false,depAmt:'',depMethod:S.methods[0]||'Efectivo',depDate:todayISO(),depNote:'',token:tok()};
  if(t)wizInitTrip(m,t);
  openModal(m);
}
function wizInitTrip(m,t){m.tripId=t.id;m.price=String(t.price);if(t.pickups.length===1)m.pickupId=t.pickups[0].pointId}
function mWiz(m){
  const t=m.tripId?tripById(m.tripId):null;
  if(!t||m.step===0){const up=upcomingTrips();
    return dlgHead('Agregar pasajero','Primero elegí el viaje')+`<div class="dlg-body">${up.length?`<div class="results">${up.map(x=>{const k=tripCounts(x);return `<button class="result" data-act="wizTrip" data-id="${x.id}"${k.free?'':' disabled'}><span><b>${esc(x.name)}</b><small>${esc(fDate(x.departDate))} · ${esc(VEH[x.vehicle.type])}</small></span><span class="small">${k.free?`${plural(k.free,'butaca libre','butacas libres')}`:'Sin butacas libres'}</span></button>`}).join('')}</div>`:'<p class="empty">No hay viajes próximos. Primero creá un viaje.</p>'}${errSlot}</div><div class="dlg-foot"><button class="btn btn-ghost" data-act="close">Cancelar</button></div>`}
  const steps=['Cliente','Subida y butaca','Precio y pago','Confirmar'];
  const stepper=`<ol class="steps">${steps.map((s,i)=>`<li class="step ${i+1===m.step?'on':i+1<m.step?'done':''}"><b>${i+1<m.step?ic('check'):i+1}</b>${s}</li>`).join('')}</ol>`;
  let body='',foot='';
  if(m.step===1){
    if(m.creating){body=`${clientFields('wc',m.draft||{})}`;foot=`<button class="btn btn-ghost" data-act="wizCancelNew">Volver a buscar</button><span class="spacer"></span><button class="btn" data-act="wizSaveClient">Guardar cliente y seguir</button>`}
    else if(m.clientId){const c=clientById(m.clientId),miss=incomplete(c),n=doneCount(c.id);
      body=`<div class="picked"><div><p class="eyebrow">Cliente elegido</p><p class="big">${esc(nameOf(c))}</p><p class="muted">${esc(fDoc(c)||'Sin documento')}${c.birthDate?' · nació el '+esc(fDateNum(c.birthDate)):''}</p><p class="small">${n?`Ya viajó ${n===1?'1 vez':n+' veces'} con Nieves Viajes.`:'Primer viaje con Nieves Viajes.'}${clientCreditLeft(c.id)>0?` Tiene <b>${money(clientCreditLeft(c.id))}</b> de saldo a favor.`:''}</p></div><button class="link" data-act="wizClear">Cambiar</button></div>
      ${miss.length?`<div class="warnbox">${ic('alert')}<p>Le falta ${miss.join(' y ')}. Podés seguir y completarlo después desde su ficha.</p></div>`:''}`;
      foot=`<button class="btn btn-ghost" data-act="close">Cancelar</button><span class="spacer"></span><button class="btn" data-act="wizNext">Siguiente</button>`}
    else{body=`<label class="field"><span>Buscar cliente por nombre o documento</span><input type="search" id="w-q" data-bind="q" value="${esc(m.q)}" placeholder="Ej: Gómez o 90237911" autocomplete="off" autofocus></label><div id="w-results">${wizResults(m,t)}</div>
      <div class="or"><span class="muted">¿Es la primera vez que viaja?</span><button class="btn btn-2" data-act="wizNewClient">${ic('plus')}Crear cliente nuevo</button></div>`;
      foot=`<button class="btn btn-ghost" data-act="close">Cancelar</button>`}
  }else if(m.step===2){
    if(m.seatId&&(seatOcc(t,m.seatId)||blockOf(t,m.seatId)||!seatById(t,m.seatId)))m.seatId='';
    const seated=tripRes(t.id).filter(r=>r.seatId);
    body=`<div class="fblock"><h3>¿Dónde sube?</h3><div class="choices">${t.pickups.map(p=>`<label class="choice"><input type="radio" name="w-pk" value="${p.pointId}" data-bind="pickupId"${m.pickupId===p.pointId?' checked':''}><span><b>${esc(pointName(p.pointId))}</b>${p.time?` <span class="muted">· ${esc(p.time)}</span>`:''}</span></label>`).join('')}</div></div>
    <div class="fblock"><h3>Butaca</h3><div class="seg" role="group" aria-label="Tipo de lugar"><button data-act="wizMode" data-mode="seat" aria-pressed="${m.mode==='seat'}">Con butaca</button><button data-act="wizMode" data-mode="infant" aria-pressed="${m.mode==='infant'}">Bebé sin butaca</button></div>
    ${m.mode==='seat'?`<p>Butaca elegida: <b>${m.seatId?esc(seatLabel(t,m.seatId)):'ninguna todavía'}</b>. Tocá una butaca verde.</p>${legendHTML()}${seatMapHTML(t,{mode:'pick',selected:m.seatId,act:'wizSeat'})}`
      :`<label class="field"><span>Viaja en brazos de</span><select data-bind="infantOf"><option value="">Elegí un adulto del viaje</option>${seated.map(r=>`<option value="${r.id}"${m.infantOf===r.id?' selected':''}>${esc(nameOf(clientById(r.clientId)))} · butaca ${esc(seatLabel(t,r.seatId))}</option>`).join('')}</select><small>Figura en la lista del chofer y no ocupa butaca. Queda en el mismo grupo que el adulto.</small></label>`}</div>
    ${m.mode==='seat'?`<div class="fblock"><h3>¿Paga junto con alguien del viaje? (opcional)</h3><label class="field"><span>Grupo</span><select data-bind="groupWith"><option value="">No, paga por su cuenta</option>${tripRes(t.id).filter(r=>r.seatId).map(r=>`<option value="${r.id}"${m.groupWith===r.id?' selected':''}>${esc(nameOf(clientById(r.clientId)))}${groupOf(r)?' ('+esc(groupOf(r).name)+')':''}</option>`).join('')}</select><small>Sirve para registrar un solo pago y repartirlo entre las reservas del grupo.</small></label></div>`:''}`;
    foot=`<button class="btn btn-ghost" data-act="wizBack">Atrás</button><span class="spacer"></span><button class="btn" data-act="wizNext">Siguiente</button>`;
  }else if(m.step===3){
    const diff=parseMoney(m.price)!==t.price,cr=clientCreditLeft(m.clientId);
    body=`<div class="fblock"><h3>Precio acordado</h3><div class="fgrid"><label class="field"><span>Precio para este pasajero</span><input type="text" id="w-price" inputmode="numeric" data-bind="price" value="${esc(m.price)}" autocomplete="off"><small>Precio del viaje: ${money(t.price)}</small></label></div>
      <div class="fblock" id="w-reason"${diff?'':' hidden'}><p class="lbl">Motivo del precio distinto</p><div class="chips">${REASONS.map(x=>`<button class="chip" data-act="wizReason" data-r="${x}" aria-pressed="${m.reason===x}">${x}</button>`).join('')}</div><label class="field"><span>Detalle (opcional)</span><input type="text" data-bind="reasonText" value="${esc(m.reasonText)}" placeholder="Ej: paga todo en efectivo"></label></div></div>
    <div class="fblock"><h3>Seña o pago</h3><label class="choice"><input type="checkbox" data-bind="dep"${m.dep?' checked':''}><span>Registrar un pago ahora</span></label>
      <div id="w-dep"${m.dep?'':' hidden'}><div class="fgrid"><label class="field"><span>Importe</span><input type="text" inputmode="numeric" data-bind="depAmt" value="${esc(m.depAmt)}" placeholder="Ej: 50.000"></label>
      <label class="field"><span>Medio de pago</span><select data-bind="depMethod">${[...S.methods,...(cr>0?[CREDIT]:[])].map(x=>`<option${m.depMethod===x?' selected':''}>${esc(x)}</option>`).join('')}</select>${cr>0?`<small>Saldo a favor disponible: ${money(cr)}</small>`:''}</label>
      <label class="field"><span>Fecha</span><input type="date" data-bind="depDate" value="${esc(m.depDate)}" max="${todayISO()}"></label>
      <label class="field"><span>Nota (opcional)</span><input type="text" data-bind="depNote" value="${esc(m.depNote)}" placeholder="Ej: seña"></label></div></div>
      <p class="muted small">Si todavía no pagó, dejalo sin marcar: la reserva queda con todo el saldo pendiente.</p></div>`;
    foot=`<button class="btn btn-ghost" data-act="wizBack">Atrás</button><span class="spacer"></span><button class="btn" data-act="wizNext">Siguiente</button>`;
  }else{
    const c=clientById(m.clientId),price=parseMoney(m.price),dep=m.dep?parseMoney(m.depAmt):0;
    const adult=m.mode==='infant'?resById(m.infantOf):null,gw=m.groupWith?resById(m.groupWith):null;
    const reason=price!==t.price?[m.reason,m.reasonText.trim()].filter(Boolean).join(': '):'';
    body=`<dl class="dl"><dt>Cliente</dt><dd>${esc(nameOf(c))}<small>${esc(fDoc(c)||'Sin documento')}</small></dd><dt>Viaje</dt><dd>${esc(t.name)}<small>${esc(fDateLong(t.departDate))}</small></dd>
      <dt>Sube en</dt><dd>${esc(pickupLabel(t,m.pickupId))}</dd><dt>Butaca</dt><dd>${adult?`Bebé en brazos de ${esc(nameOf(clientById(adult.clientId)))}`:esc(seatLabel(t,m.seatId))}</dd>
      ${gw?`<dt>Grupo</dt><dd>Con ${esc(nameOf(clientById(gw.clientId)))}</dd>`:''}
      <dt>Precio acordado</dt><dd>${money(price)}${reason?`<small>Motivo: ${esc(reason)}</small>`:''}</dd>
      <dt>Pago ahora</dt><dd>${dep?`${money(dep)} · ${esc(m.depMethod)}`:'Sin pago por ahora'}</dd><dt>Saldo</dt><dd>${money(price-dep)}</dd></dl>`;
    foot=`<button class="btn btn-ghost" data-act="wizBack">Atrás</button><span class="spacer"></span><button class="btn" data-act="wizSave">${ic('check')}Guardar reserva</button>`;
  }
  return dlgHead('Agregar pasajero',`${t.name} · ${fDate(t.departDate)}`)+stepper+`<div class="dlg-body">${body}${errSlot}</div><div class="dlg-foot">${foot}</div>`;
}
function wizResults(m,t){
  if(!norm(m.q))return '<p class="muted small">Escribí al menos una letra o número del documento.</p>';
  const list=S.clients.filter(c=>clientMatch(c,m.q)).slice(0,8);
  if(!list.length)return `<p class="muted">No hay nadie con “${esc(m.q)}”. Si es alguien nuevo, creá el cliente.</p>`;
  return `<div class="results">${list.map(c=>{const already=tripRes(t.id).some(r=>r.clientId===c.id),n=doneCount(c.id);
    return `<button class="result" data-act="wizPick" data-id="${c.id}"${already?' disabled':''}><span><b>${esc(nameOf(c))}</b><small>${esc(fDoc(c)||'Sin documento')}${c.birthDate?' · '+esc(fDateNum(c.birthDate)):''}</small></span><span class="small muted">${already?'Ya viaja en esta salida':n?`${plural(n,'viaje realizado','viajes realizados')}`:'Sin viajes realizados'}</span></button>`}).join('')}</div>`;
}
function wizValidate(m){
  const t=tripById(m.tripId);
  if(m.step===1){if(!m.clientId)fail('Elegí un cliente de la lista o creá uno nuevo.');if(tripRes(t.id).some(r=>r.clientId===m.clientId))fail('Esa persona ya tiene una reserva en este viaje.')}
  if(m.step===2){if(!m.pickupId)fail('Elegí dónde sube.');if(m.mode==='seat'){if(!m.seatId)fail('Elegí una butaca libre en el plano.');checkSeatFree(t,m.seatId)}else if(!m.infantOf)fail('Elegí con qué adulto viaja el bebé.')}
  if(m.step===3){const p=parseMoney(m.price);if(!(p>=0))fail('Escribí el precio con números.');if(p!==t.price&&!m.reason&&!m.reasonText.trim())fail('Elegí el motivo del precio distinto.');
    if(m.dep){const a=parseMoney(m.depAmt);if(!(a>0))fail('Escribí el importe del pago.');if(a>p)fail('El pago no puede superar el precio acordado.');if(m.depDate>todayISO())fail('La fecha del pago no puede ser futura.');if(m.depMethod===CREDIT&&a>clientCreditLeft(m.clientId))fail(`El saldo a favor disponible es de ${money(clientCreditLeft(m.clientId))}.`)}}
}
function mDone(m){const r=resById(m.resId),t=tripById(m.tripId);const c=r?clientById(r.clientId):null;
  return dlgHead('Reserva guardada',t.name)+`<div class="dlg-body"><p class="big">${esc(nameOf(c))}${r&&r.seatId?` · butaca ${esc(seatLabel(t,r.seatId))}`:r?' · bebé sin butaca':''}</p><p class="muted">Ya figura en la lista de pasajeros, en el plano y en su ficha de cliente.</p></div>
  <div class="dlg-foot"><button class="btn btn-ghost" data-act="close">Listo</button><button class="btn btn-ghost" data-act="doneList">Ver lista</button><button class="btn" data-act="wizard" data-trip="${t.id}">${ic('plus')}Agregar otro pasajero</button></div>`}

/* ---- Registrar pago desde Inicio ---- */
function mPayFind(m){
  return dlgHead('Registrar pago','Buscá al pasajero')+`<div class="dlg-body"><label class="field"><span>Nombre o documento</span><input type="search" id="pf-q" data-bind="q" value="${esc(m.q)}" placeholder="Ej: Gómez" autocomplete="off" autofocus></label><div id="pf-results">${payFindResults(m)}</div>${errSlot}</div><div class="dlg-foot"><button class="btn btn-ghost" data-act="close">Cancelar</button></div>`}
function payFindResults(m){
  const T=todayISO();
  let list=S.reservations.filter(r=>r.status==='activa'&&tripEnd(tripById(r.tripId))>=T&&clientMatch(clientById(r.clientId),m.q));
  list.sort((a,b)=>(balanceOf(b)>0)-(balanceOf(a)>0)||tripById(a.tripId).departDate.localeCompare(tripById(b.tripId).departDate));
  list=list.slice(0,10);
  if(!list.length)return '<p class="muted">No hay reservas activas que coincidan.</p>';
  return `<div class="results">${list.map(r=>{const t=tripById(r.tripId),c=clientById(r.clientId);return `<button class="result" data-act="pfPick" data-id="${r.id}"><span><b>${esc(nameOf(c))}</b><small>${esc(t.name)} · ${esc(fDate(t.departDate))}</small></span><span class="small">${balanceOf(r)>0?`Saldo ${money(balanceOf(r))}`:'Sin saldo'}</span></button>`}).join('')}</div>`;
}

/* ---- Reserva (detalle y acciones) ---- */
function mRes(m){
  const r=resById(m.id);if(!r)return dlgHead('Reserva')+'<div class="dlg-body"><p>No se encontró la reserva.</p></div>';
  const t=tripById(r.tripId),c=clientById(r.clientId);
  if(m.sub&&SUBS[m.sub])return SUBS[m.sub](m,r,t,c);
  const paid=paidOf(r.id),act=r.status==='activa',g=groupOf(r),adult=r.infantOf&&resById(r.infantOf);
  const pays=S.payments.filter(p=>p.alloc.some(a=>a.r===r.id)).sort((a,b)=>(b.date+b.createdAt).localeCompare(a.date+a.createdAt));
  const refunds=S.refunds.filter(d=>d.resId===r.id);
  const seatTxt=r.seatId?`Butaca ${seatLabel(t,r.seatId)}`:r.status==='cancelada'&&r.cancel?.seatNum?`Tenía la butaca ${r.cancel.seatNum}`:adult?`Bebé en brazos de ${nameOf(clientById(adult.clientId))}${adult.status!=='activa'?' (dado de baja)':''}`:'Sin butaca';
  const hist=[...r.priceLog.map(x=>({at:x.at,t:x.from==null?`Reserva creada por ${x.by} con precio ${money(x.to)}${x.reason&&x.reason!=='Precio del viaje'?` (${x.reason})`:''}`:`${x.by} cambió el precio de ${money(x.from)} a ${money(x.to)}: ${x.reason}`})),...r.seatLog.map(x=>({at:x.at,t:`${x.by} la cambió de la butaca ${x.from} a la ${x.to}`})),...(r.cancel?[{at:r.cancel.at,t:`${r.cancel.by} la dio de baja${r.cancel.reason?': '+r.cancel.reason:''}`}]:[]),...(r.cancel?.resolvedAt?[{at:r.cancel.resolvedAt,t:`${r.cancel.resolvedBy} resolvió el dinero de la baja`}]:[])].sort((a,b)=>a.at.localeCompare(b.at));
  let gInfo='';
  if(g){const mem=groupMembers(g.id);gInfo=`<dt>Grupo</dt><dd>${esc(g.name)}<small>${mem.map(x=>`${esc(nameOf(clientById(x.clientId)))} (saldo ${money(balanceOf(x))})`).join(' · ')}</small><small>Saldo del grupo: ${money(mem.reduce((s,x)=>s+balanceOf(x),0))}</small></dd>`}
  let cancelBox='';
  if(!act&&r.cancel){const cc=r.cancel;let fate='No había pagado nada.';
    if(cc.paid>0){if(cc.money==='devuelto'){const d=S.refunds.find(x=>x.id===cc.refundId);fate=`Se le devolvieron ${money(cc.paid)}${d?` el ${fDateNum(d.date)} por ${d.method}`:''}.`}else if(cc.money==='saldo'){const x=S.credits.find(y=>y.id===cc.creditId);fate=`${money(cc.paid)} quedaron como saldo a favor${x?` (disponible: ${money(creditLeft(x))})`:''}.`}else fate=`${money(cc.paid)} pendientes de resolver.`}
    cancelBox=`<div class="cancel-box"><p><b>Dada de baja</b> el ${esc(fStamp(cc.at))} por ${esc(cc.by)}${cc.reason?`. Motivo: ${esc(cc.reason)}`:''}.</p><p>${esc(fate)}</p>${cc.money==='pendiente'?'<div><button class="btn btn-2 btn-sm" data-act="sub" data-sub="resolve">Resolver el dinero</button></div>':''}</div>`}
  return dlgHead(nameOf(c),`${t.name} · ${fDate(t.departDate)}`)+`<div class="dlg-body">
    <div class="chips">${act?payPill(r):'<span class="pill p-muted">Dada de baja</span>'}${incomplete(c).length?`<span class="pill p-warn">${ic('alert')}Falta ${incomplete(c).join(' y ')}</span>`:''}</div>
    ${cancelBox}
    <div class="money3 compact"><div><span>Precio acordado</span><b>${money(r.price)}</b></div><div><span>Abonado</span><b>${money(paid)}</b></div><div><span>Saldo</span><b>${money(r.price-paid)}</b></div></div>
    <dl class="dl"><dt>Lugar</dt><dd>${esc(seatTxt)}</dd><dt>Sube en</dt><dd>${esc(pickupLabel(t,r.pickupId))}</dd>${gInfo}<dt>Documento</dt><dd>${esc(fDoc(c)||'—')}</dd><dt>Teléfono</dt><dd>${esc(c.phone||'—')}</dd>${c.notes?`<dt>Observaciones</dt><dd>${esc(c.notes)}<small>Privadas: no salen en la lista del chofer.</small></dd>`:''}</dl>
    ${act?`<div class="actions-grid">${r.seatId?'<button class="btn btn-ghost btn-sm" data-act="sub" data-sub="seat">Cambiar de butaca</button>':'<button class="btn btn-ghost btn-sm" data-act="sub" data-sub="infant">Cambiar adulto</button>'}<button class="btn btn-ghost btn-sm" data-act="sub" data-sub="pickup">Cambiar subida</button><button class="btn btn-ghost btn-sm" data-act="sub" data-sub="price">Cambiar precio</button>${r.infantOf?'':'<button class="btn btn-ghost btn-sm" data-act="sub" data-sub="group">Grupo</button>'}<button class="btn btn-ghost btn-sm" data-act="toClient" data-id="${c.id}">Ver ficha</button></div>`:`<div><button class="btn btn-ghost btn-sm" data-act="toClient" data-id="${c.id}">Ver ficha del cliente</button></div>`}
    <section><h3>Pagos</h3>${pays.length||refunds.length?`<ul class="paylist">${pays.map(p=>payItem(p,r)).join('')}${refunds.map(d=>`<li><span class="pay-date">${esc(fDateNum(d.date))}</span><span><b>Devolución de ${money(d.amount)}</b> · ${esc(d.method)}${d.note?`<small>${esc(d.note)}</small>`:''}<small>Registró ${esc(d.by)} el ${esc(fStamp(d.at))}</small></span><span></span></li>`).join('')}</ul>`:'<p class="muted">Todavía no registró pagos.</p>'}</section>
    <section><h3>Historial</h3><ul class="hist">${hist.map(h=>`<li><time>${esc(fStamp(h.at))}</time><span>${esc(h.t)}</span></li>`).join('')}</ul></section>
    ${act?`<div style="border-top:1px solid var(--line);padding-top:14px"><button class="btn btn-ghost" style="color:var(--bad);border-color:var(--bad)" data-act="sub" data-sub="cancel">Dar de baja</button></div>`:''}
    ${errSlot}</div>
  <div class="dlg-foot"><button class="btn btn-ghost" data-act="close">Cerrar</button>${act&&r.price-paid>0?`<button class="btn" data-act="sub" data-sub="pay">${ic('cash')}Registrar pago</button>`:''}</div>`;
}
function payItem(p,r){
  const part=p.alloc.find(a=>a.r===r.id),grp=p.alloc.length>1,v=p.status!=='valido';
  return `<li class="${v?'void':''}"><span class="pay-date">${esc(fDateNum(p.date))}</span><span><b>${money(part.amt)}</b> · ${esc(p.method)}${grp?`<small>Parte de un pago de grupo de ${money(p.amount)}</small>`:''}${p.note?`<small>${esc(p.note)}</small>`:''}<small>Registró ${esc(p.by)} el ${esc(fStamp(p.createdAt))}</small>${v?`<small class="void-note">Anulado por ${esc(p.voidedBy)} el ${esc(fStamp(p.voidedAt))}: ${esc(p.voidReason)}</small>`:''}</span>${!v&&r.status==='activa'?`<button class="btn btn-ghost btn-sm" data-act="voidAsk" data-pid="${p.id}">Anular</button>`:'<span></span>'}</li>`;
}
const backBtn='<button class="btn btn-ghost" data-act="sub" data-sub="">Volver</button>';
function moneyChoice(prefix,paid,withPending){
  return `<div class="fblock"><h3>Ya pagó ${money(paid)}. ¿Qué pasa con ese dinero?</h3><div class="choices">
    <label class="choice"><input type="radio" name="${prefix}-money" value="devuelto"><span>Se le devolvió</span></label>
    <div class="newpoint" id="${prefix}-refund" hidden><div class="fgrid"><label class="field"><span>Fecha de la devolución</span><input type="date" id="${prefix}-rdate" value="${todayISO()}" max="${todayISO()}"></label><label class="field"><span>Medio</span><select id="${prefix}-rmethod">${S.methods.map(x=>`<option>${esc(x)}</option>`).join('')}</select></label><label class="field full"><span>Nota (opcional)</span><input type="text" id="${prefix}-rnote"></label></div></div>
    <label class="choice"><input type="radio" name="${prefix}-money" value="saldo"><span>Queda como saldo a favor para otro viaje</span></label>
    ${withPending?`<label class="choice"><input type="radio" name="${prefix}-money" value="pendiente"><span>Pendiente de resolver</span></label>`:''}</div>
    <p class="muted small">No se borra ningún pago ni se devuelve dinero automáticamente: solo queda registrado lo que pasó.</p></div>`;
}
function readMoney(prefix){const v=id=>($('#'+prefix+'-'+id)||{}).value||'';return{money:($(`input[name="${prefix}-money"]:checked`)||{}).value,refundDate:v('rdate'),refundMethod:v('rmethod'),refundNote:v('rnote')}}
const SUBS={
  pay(m,r,t,c){
    const g=groupOf(r);let mem=[r];if(g)mem=[r,...groupMembers(g.id).filter(x=>x.id!==r.id)];
    mem=mem.filter(x=>x.status==='activa'&&balanceOf(x)>0);if(!mem.includes(r))mem.unshift(r);
    const cr=clientCreditLeft(r.clientId),multi=mem.length>1;
    if(!m.tok)m.tok=tok();
    return dlgHead('Registrar pago',`${nameOf(c)} · ${t.name}`)+`<div class="dlg-body">
      <p>Saldo de ${esc(nameOf(c))}: <b>${money(balanceOf(r))}</b>${multi?` · saldo del grupo: <b>${money(mem.reduce((s,x)=>s+balanceOf(x),0))}</b>`:''}</p>
      <div class="fgrid"><label class="field"><span>Importe</span><input type="text" id="pay-amt" inputmode="numeric" autocomplete="off" placeholder="Ej: 80.000" autofocus><small id="pay-fmt"></small></label>
      <label class="field"><span>Medio de pago</span><select id="pay-method">${[...S.methods,...(cr>0?[CREDIT]:[])].map(x=>`<option>${esc(x)}</option>`).join('')}</select>${cr>0?`<small>Saldo a favor disponible: ${money(cr)}</small>`:''}</label>
      <label class="field"><span>Fecha</span><input type="date" id="pay-date" value="${todayISO()}" max="${todayISO()}"></label>
      <label class="field"><span>Nota (opcional)</span><input type="text" id="pay-note" placeholder="Ej: transferencia de su hija"></label></div>
      ${multi?`<div class="fblock"><h3>Repartir entre el grupo</h3><p class="muted small">Se completa en orden empezando por ${esc(nameOf(c))}. Podés cambiar los importes.</p><div class="alloc">${mem.map(x=>`<label class="alloc-row"><span><b>${esc(nameOf(clientById(x.clientId)))}</b><small>${x.seatId?'Butaca '+esc(seatLabel(t,x.seatId)):'Bebé'} · saldo ${money(balanceOf(x))}</small></span><input type="text" inputmode="numeric" data-alloc="${x.id}" aria-label="Importe para ${esc(nameOf(clientById(x.clientId)))}"></label>`).join('')}</div><p class="small" id="alloc-sum"></p></div>`:''}
      ${errSlot}</div><div class="dlg-foot">${m.direct?'<button class="btn btn-ghost" data-act="close">Cancelar</button>':backBtn}<button class="btn" data-act="payDo">${ic('check')}Registrar pago</button></div>`;
  },
  void(m,r,t,c){
    const p=S.payments.find(x=>x.id===m.pid);if(!p)return backBtn;
    const others=p.alloc.filter(a=>a.r!==r.id).map(a=>nameOf(clientById(resById(a.r)?.clientId)));
    return dlgHead('Anular pago',`${nameOf(c)} · ${t.name}`)+`<div class="dlg-body">
      <p>Vas a anular el pago de <b>${money(p.amount)}</b> del ${esc(fDateNum(p.date))} (${esc(p.method)}).</p>
      ${others.length?`<div class="warnbox">${ic('alert')}<p>Era un pago de grupo: también se anula la parte de ${esc(others.join(', '))}.</p></div>`:''}
      <p class="muted">El pago no se borra: queda tachado en el historial con el motivo. Después podés cargar el pago correcto.</p>
      <label class="field"><span>Motivo de la anulación</span><input type="text" id="void-reason" placeholder="Ej: se cargó dos veces" autofocus></label>${errSlot}</div>
      <div class="dlg-foot">${backBtn}<button class="btn btn-danger" data-act="voidDo">Anular pago</button></div>`;
  },
  seat(m,r,t,c){
    return dlgHead('Cambiar de butaca',`${nameOf(c)} · hoy en la butaca ${seatLabel(t,r.seatId)}`)+`<div class="dlg-body"><p>Elegí la butaca nueva. Sus datos y pagos no cambian.</p>${legendHTML()}${seatMapHTML(t,{mode:'pick',selected:m.sel,act:'mvSeat'})}${errSlot}</div>
      <div class="dlg-foot">${backBtn}<button class="btn" data-act="mvDo"${m.sel?'':' disabled'}>${m.sel?`Mover a la butaca ${esc(seatLabel(t,m.sel))}`:'Elegí una butaca'}</button></div>`;
  },
  pickup(m,r,t,c){
    return dlgHead('Cambiar lugar de subida',nameOf(c))+`<div class="dlg-body"><div class="choices">${t.pickups.map(p=>`<label class="choice"><input type="radio" name="pk-new" value="${p.pointId}"${r.pickupId===p.pointId?' checked':''}><span><b>${esc(pointName(p.pointId))}</b>${p.time?` <span class="muted">· ${esc(p.time)}</span>`:''}</span></label>`).join('')}</div><p class="muted small">El precio no cambia según el lugar de subida.</p>${errSlot}</div>
      <div class="dlg-foot">${backBtn}<button class="btn" data-act="pickupDo">Guardar</button></div>`;
  },
  price(m,r,t,c){
    return dlgHead('Cambiar precio acordado',nameOf(c))+`<div class="dlg-body"><p>Precio actual: <b>${money(r.price)}</b> · abonado: ${money(paidOf(r.id))} · precio del viaje: ${money(t.price)}</p>
      <label class="field"><span>Precio nuevo</span><input type="text" id="price-new" inputmode="numeric" autocomplete="off" autofocus></label>
      <div class="fblock"><p class="lbl">Motivo</p><div class="chips">${REASONS.map(x=>`<button class="chip" data-act="priceReason" data-r="${x}" aria-pressed="${m.reason===x}">${x}</button>`).join('')}</div>
      <label class="field"><span>Detalle</span><input type="text" id="price-detail" placeholder="Ej: acordó pagar todo en efectivo"></label></div>
      <p class="muted small">El cambio queda registrado en el historial de la reserva.</p>${errSlot}</div>
      <div class="dlg-foot">${backBtn}<button class="btn" data-act="priceDo">Guardar precio</button></div>`;
  },
  group(m,r,t,c){
    const g=groupOf(r);const others=tripRes(t.id).filter(x=>x.id!==r.id&&x.seatId&&(!g||x.groupId!==g.id));
    return dlgHead('Grupo de pago',nameOf(c))+`<div class="dlg-body">
      ${g?`<p>Está en el <b>${esc(g.name)}</b> con ${esc(groupMembers(g.id).filter(x=>x.id!==r.id).map(x=>nameOf(clientById(x.clientId))).join(', '))}.</p><div><button class="btn btn-ghost btn-sm" data-act="groupLeave">Quitar del grupo</button></div>`:'<p>Paga por su cuenta.</p>'}
      <label class="field"><span>${g?'Pasar a pagar junto con':'Pagar junto con'}</span><select id="group-with"><option value="">Elegí a alguien del viaje</option>${others.map(x=>`<option value="${x.id}">${esc(nameOf(clientById(x.clientId)))}${groupOf(x)?' ('+esc(groupOf(x).name)+')':''}</option>`).join('')}</select><small>Cada reserva conserva sus propios pagos y saldo; el grupo sirve para registrar un pago y repartirlo.</small></label>${errSlot}</div>
      <div class="dlg-foot">${backBtn}<button class="btn" data-act="groupJoin">Agrupar</button></div>`;
  },
  infant(m,r,t,c){
    const seated=tripRes(t.id).filter(x=>x.seatId);
    return dlgHead('Con quién viaja',nameOf(c))+`<div class="dlg-body"><label class="field"><span>Viaja en brazos de</span><select id="infant-adult"><option value="">Elegí un adulto</option>${seated.map(x=>`<option value="${x.id}"${r.infantOf===x.id?' selected':''}>${esc(nameOf(clientById(x.clientId)))} · butaca ${esc(seatLabel(t,x.seatId))}</option>`).join('')}</select></label>${errSlot}</div>
      <div class="dlg-foot">${backBtn}<button class="btn" data-act="infantDo">Guardar</button></div>`;
  },
  cancel(m,r,t,c){
    const paid=paidOf(r.id),inf=S.reservations.filter(x=>x.infantOf===r.id&&x.status==='activa');
    return dlgHead('Dar de baja',`${nameOf(c)} · ${t.name}`)+`<div class="dlg-body">
      <p>Vas a dar de baja a <b>${esc(nameOf(c))}</b> del viaje <b>${esc(t.name)}</b>.</p>
      <ul class="checklist">${r.seatId?`<li>Se libera la butaca ${esc(seatLabel(t,r.seatId))}.</li>`:''}<li>Deja de aparecer en la lista del chofer.</li><li>Se conservan su ficha, esta reserva y sus pagos en el historial.</li></ul>
      ${inf.length?`<label class="choice"><input type="checkbox" id="c-inf" checked><span>Dar de baja también a ${esc(inf.map(x=>nameOf(clientById(x.clientId))).join(', '))} (viaja en brazos)</span></label>`:''}
      <label class="field"><span>Motivo (opcional)</span><input type="text" id="c-reason" placeholder="Ej: problema de salud"></label>
      ${paid>0?moneyChoice('c',paid,true):'<p class="muted">No registró pagos en esta reserva.</p>'}${errSlot}</div>
      <div class="dlg-foot">${backBtn}<button class="btn btn-danger" data-act="cancelDo">Dar de baja</button></div>`;
  },
  resolve(m,r,t,c){
    return dlgHead('Resolver dinero de la baja',`${nameOf(c)} · ${t.name}`)+`<div class="dlg-body">${moneyChoice('rs',r.cancel.paid,false)}${errSlot}</div><div class="dlg-foot">${backBtn}<button class="btn" data-act="resolveDo">Guardar</button></div>`;
  }
};

/* ---- Butaca (información) ---- */
function mSeat(m){
  const t=tripById(m.tripId),s=seatById(t,m.sid);if(!s)return dlgHead('Butaca')+'<div class="dlg-body"><p>No se encontró la butaca.</p></div>';
  const occ=seatOcc(t,s.id),blk=blockOf(t,s.id);
  const title=`Butaca ${s.num}${s.floor!=='unica'?' · '+FLOOR[s.floor]:''}`;
  if(occ){const c=clientById(occ.clientId);
    return dlgHead(title,'Ocupada')+`<div class="dlg-body"><p class="big">${esc(nameOf(c))}</p><p class="muted">${esc(fDoc(c)||'Sin documento')} · sube en ${esc(pickupLabel(t,occ.pickupId))}</p><div class="chips">${payPill(occ)}<span class="pill p-muted">Saldo ${money(balanceOf(occ))}</span></div></div>
    <div class="dlg-foot"><button class="btn btn-ghost" data-act="seatMove" data-id="${occ.id}">Cambiar de butaca</button><button class="btn" data-act="openRes" data-id="${occ.id}">Ver reserva</button></div>`}
  if(blk)return dlgHead(title,'Bloqueada')+`<div class="dlg-body"><p>Motivo: <b>${esc(blk.reason)}</b>${blk.name?` · ${esc(blk.name)}`:''}</p><p class="muted">Una butaca bloqueada no se puede vender.</p></div>
    <div class="dlg-foot"><button class="btn btn-ghost" data-act="close">Cerrar</button><button class="btn" data-act="seatUnblock">Desbloquear</button></div>`;
  if(m.blocking)return dlgHead(title,'Bloquear butaca')+`<div class="dlg-body"><div class="choices">${BLOCK_REASONS.map((x,i)=>`<label class="choice"><input type="radio" name="blk-r" value="${x}"${i===0?' checked':''}><span>${x}</span></label>`).join('')}</div>
    <label class="field"><span>Nombre (opcional)</span><input type="text" id="blk-name" placeholder="Ej: Nieves"><small>Si lo completás, aparece en la lista del chofer.</small></label>${errSlot}</div>
    <div class="dlg-foot"><button class="btn btn-ghost" data-act="close">Cancelar</button><button class="btn" data-act="seatBlockDo">${ic('lock')}Bloquear</button></div>`;
  return dlgHead(title,'Libre')+`<div class="dlg-body"><p>Esta butaca está libre.</p></div>
    <div class="dlg-foot"><button class="btn btn-ghost" data-act="seatBlock">${ic('lock')}Bloquear</button><button class="btn" data-act="wizard" data-trip="${t.id}" data-sid="${s.id}">${ic('plus')}Agregar pasajero acá</button></div>`;
}

/* ---- Ajuste del plano ---- */
function mEdSeat(m){const t=tripById(m.tripId),s=seatById(t,m.sid);const busy=seatOcc(t,s.id)||blockOf(t,s.id);
  return dlgHead(`Butaca ${s.num}`,'Ajustar plano')+`<div class="dlg-body"><label class="field"><span>Número de la butaca</span><input type="text" id="ed-num" value="${esc(s.num)}" autocomplete="off" autofocus><small>Usá el número que tiene la butaca en el vehículo real.</small></label>${busy?'<p class="muted small">Está ocupada o bloqueada: podés cambiarle el número, pero no quitarla.</p>':''}${errSlot}</div>
  <div class="dlg-foot">${busy?'':'<button class="btn btn-ghost" style="color:var(--bad);border-color:var(--bad)" data-act="edRemove">Quitar butaca</button>'}<span class="spacer"></span><button class="btn btn-ghost" data-act="close">Cancelar</button><button class="btn" data-act="edNumDo">Guardar número</button></div>`}
function mEdAdd(m){const t=tripById(m.tripId);
  return dlgHead('Agregar butaca',`${FLOOR[m.floor]||'Plano'} · fila ${m.r+1}`)+`<div class="dlg-body"><label class="field"><span>Número de la butaca</span><input type="text" id="ed-num" value="${esc(nextSeatNum(t))}" autocomplete="off" autofocus></label>${errSlot}</div>
  <div class="dlg-foot"><button class="btn btn-ghost" data-act="close">Cancelar</button><button class="btn" data-act="edAddDo">Agregar</button></div>`}
function mEdRenumber(m){const t=tripById(m.tripId);const two=t.seats.some(s=>s.floor==='alta')&&t.seats.some(s=>s.floor==='baja');
  return dlgHead('Numerar de nuevo','Ajustar plano')+`<div class="dlg-body"><p>Las butacas se numeran de adelante hacia atrás y de izquierda a derecha. Los pasajeros quedan en el mismo lugar físico, pero su número puede cambiar.</p>
  ${two?`<div class="choices"><label class="choice"><input type="radio" name="ren-o" value="alta" checked><span>Empezar por planta alta</span></label><label class="choice"><input type="radio" name="ren-o" value="baja"><span>Empezar por planta baja</span></label></div>`:''}${errSlot}</div>
  <div class="dlg-foot"><button class="btn btn-ghost" data-act="close">Cancelar</button><button class="btn" data-act="edRenumberDo">Numerar de nuevo</button></div>`}
function mEdModel(m){const t=tripById(m.tripId);
  return dlgHead('Guardar plano reutilizable',`${VEH[t.vehicle.type]} · ${t.seats.length} butacas`)+`<div class="dlg-body"><label class="field"><span>Nombre del plano</span><input type="text" id="model-name" value="${esc(`${VEH[t.vehicle.type]} ${t.seats.length}`)}" autofocus><small>Ej: “Micro 60 de la empresa del Turco”. Después lo elegís al crear un viaje.</small></label>${errSlot}</div>
  <div class="dlg-foot"><button class="btn btn-ghost" data-act="close">Cancelar</button><button class="btn" data-act="edModelDo">Guardar plano</button></div>`}

/* ---- Lugar de subida ---- */
function mPoint(m){const p=m.id?pointById(m.id):null;
  return dlgHead(p?'Editar lugar de subida':'Agregar lugar de subida')+`<div class="dlg-body"><div class="fgrid"><label class="field full"><span>Nombre</span><input type="text" id="pt-name" value="${esc(p?.name)}" placeholder="Ej: Funes" autofocus></label><label class="field full"><span>Dirección</span><input type="text" id="pt-addr" value="${esc(p?.address)}"></label><label class="field full"><span>Referencia</span><input type="text" id="pt-ref" value="${esc(p?.reference)}" placeholder="Ej: frente a la estación de servicio"></label></div>${errSlot}</div>
  <div class="dlg-foot">${p?'<button class="btn btn-ghost" style="color:var(--bad);border-color:var(--bad)" data-act="pointDelete">Borrar</button><span class="spacer"></span>':''}<button class="btn btn-ghost" data-act="close">Cancelar</button><button class="btn" data-act="pointSave">Guardar</button></div>`}

/* ================= Mensajes ================= */
function toast(msg,kind){const el=document.createElement('div');el.className='toast'+(kind==='bad'?' bad':'');el.textContent=msg;const box=$('#toast');box.appendChild(el);while(box.children.length>2)box.firstChild.remove();setTimeout(()=>el.remove(),kind==='bad'?6000:3600)}
function showErr(e){
  if(!(e instanceof UserError)){console.error(e);toast('Algo salió mal y no se guardó. Probá de nuevo.','bad');return}
  const slot=modal&&$('#modal #err');
  if(slot){slot.textContent=e.message;if(e.extra&&e.extra.dupId){const b=document.createElement('button');b.className='btn btn-2 btn-sm';b.dataset.act=modal.type==='wiz'?'wizPick':'openClient';b.dataset.id=e.extra.dupId;b.textContent=`Usar a ${nameOf(clientById(e.extra.dupId))}`;slot.appendChild(b)}slot.scrollIntoView({block:'nearest'})}
  else toast(e.message,'bad');
}
function clearErr(){const s=$('#modal #err');if(s)s.textContent=''}

/* ================= Imprimir y PDF ================= */
function isFramed(){try{return window.self!==window.top}catch(e){return true}}
let dlPromise=null;
function getDownloads(){if(!window.claude||typeof window.claude.use!=='function')return Promise.resolve(null);if(!dlPromise)dlPromise=window.claude.use('downloads').catch(()=>null);return dlPromise}
const PDF_LIBS=['vendor/jspdf.umd.min.js','vendor/jspdf.plugin.autotable.min.js'];
function loadScript(src){return new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=()=>res();s.onerror=()=>rej(new Error('No se pudo cargar '+src));document.head.appendChild(s)})}
let pdfReady=null;
function ensurePdf(){if(!pdfReady)pdfReady=(async()=>{if(!window.jspdf)await loadScript(PDF_LIBS[0]);const probe=new window.jspdf.jsPDF();if(typeof probe.autoTable!=='function')await loadScript(PDF_LIBS[1]);await logoData()})().catch(e=>{pdfReady=null;throw e});return pdfReady}
let logoJpg=null;
async function logoData(){
  if(logoJpg)return logoJpg;
  try{const b=await (await fetch('img/logo-pdf.jpg')).blob();logoJpg=await new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=rej;fr.readAsDataURL(b)})}catch(e){return null}
  return logoJpg;
}
async function makePdf(t){
  await ensurePdf();
  const {jsPDF}=window.jspdf;const doc=new jsPDF({unit:'mm',format:'a4'});
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight();
  const rows=listData(t,ui.listOrder,ui.listBlocked),k=tripCounts(t);
  const logo=await logoData();if(logo)doc.addImage(logo,'JPEG',14,7.5,14,14);
  doc.setTextColor(31,58,87);doc.setFont('times','bold');doc.setFontSize(14);doc.text('NIEVES VIAJES',31,14.3);
  doc.setTextColor(60,60,60);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text('Lista de pasajeros',31,19);
  doc.setTextColor(90,90,90);doc.text(`Lista generada el ${nowHuman()}`,W-14,14.3,{align:'right'});
  doc.setDrawColor(37,56,75);doc.setLineWidth(0.6);doc.line(14,24,W-14,24);
  doc.setTextColor(20,20,20);doc.setFont('times','bold');doc.setFontSize(18);doc.text(t.name,14,32);
  doc.setFont('helvetica','normal');doc.setFontSize(10);
  const sub=`Destino: ${[t.city,t.province].filter(Boolean).join(', ')}  ·  Salida: ${fDateLong(t.departDate)}${t.departTime?', '+t.departTime:''}  ·  ${VEH[t.vehicle.type]} de ${t.seats.length} butacas`;
  const lines=doc.splitTextToSize(sub,W-28);doc.text(lines,14,38);
  const body=rows.map(r=>r.kind==='grp'?[{content:r.label,colSpan:6,styles:{fillColor:[244,235,213],fontStyle:'bold',textColor:[60,45,10]}}]:[r.n?String(r.n):'',r.seat,r.name+(r.note?`\n(${r.note})`:''),r.doc,r.birth,r.pickup]);
  const totalKey='{total}';
  doc.autoTable({head:[['N°','Butaca','Apellido y nombre','Documento','Nacimiento','Subida']],body,startY:38+lines.length*4.4+2,theme:'grid',
    styles:{font:'helvetica',fontSize:9.5,cellPadding:1.8,textColor:[20,20,20],lineColor:[190,190,190],lineWidth:0.2,valign:'top'},
    headStyles:{fillColor:[232,237,242],textColor:[20,20,20],fontStyle:'bold',lineColor:[190,190,190],lineWidth:0.2},
    columnStyles:{0:{cellWidth:10,halign:'right'},1:{cellWidth:17,fontStyle:'bold'},2:{cellWidth:58},3:{cellWidth:38},4:{cellWidth:22}},
    margin:{left:14,right:14,top:16,bottom:16},
    didParseCell:d=>{if(d.section==='body'){const r=rows[d.row.index];if(r&&r.kind==='blk'){d.cell.styles.textColor=[100,100,100];d.cell.styles.fontStyle='italic'}}},
    didDrawPage:()=>{doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(110,110,110);doc.text(`${t.name} · salida ${fDateNum(t.departDate)}`,14,H-8);doc.text(`Página ${doc.internal.getNumberOfPages()} de ${totalKey}`,W-14,H-8,{align:'right'})}});
  let y=doc.lastAutoTable.finalY+7;if(y>H-20){doc.addPage();y=24}
  doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(20,20,20);
  doc.text(`Total: ${plural(k.seated+k.infants,'pasajero','pasajeros')} (${k.seated} con butaca${k.infants?`, ${plural(k.infants,'bebé','bebés')} sin butaca`:''}) · Butacas bloqueadas: ${k.blocked}`,14,y);
  if(typeof doc.putTotalPages==='function')doc.putTotalPages(totalKey);
  return doc.output('blob');
}
const isPhone=()=>!!(window.matchMedia&&window.matchMedia('(pointer:coarse)').matches);
function canShareFiles(){try{return isPhone()&&typeof navigator.canShare==='function'&&navigator.canShare({files:[new File(['x'],'prueba.pdf',{type:'application/pdf'})]})}catch(e){return false}}
function downloadBlob(name,blob,okMsg){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);toast(okMsg||'Listo: PDF descargado.')}
// Devuelve true si el archivo se entregó. onDone se usa si hay que pedir un toque más.
async function deliverFile(name,blob,okMsg,onDone){
  const dl=await getDownloads();
  if(dl){try{await dl.save({filename:name,data:blob});toast(okMsg||'Listo: PDF guardado.')}catch(e){if(e&&e.code==='declined')return false;toast('No se pudo guardar el archivo en esta vista.','bad');return false}return true}
  if(isFramed()){toast('Esta vista no permite descargar archivos.','bad');return false}
  const file=new File([blob],name,{type:blob.type||'application/octet-stream'});
  if(canShareFiles()&&navigator.canShare({files:[file]})){
    try{await navigator.share({files:[file],title:name});return true}
    catch(e){if(e&&e.name==='AbortError')return false;openModal({type:'file',file,okMsg,onDone:onDone||null});return false}
  }
  downloadBlob(name,blob,okMsg);return true;
}
function pdfName(t){return `Lista ${t.name} ${fDateNum(t.departDate).replace(/\//g,'-')}.pdf`.replace(/[\\/:*?"<>|]/g,'')}

/* ================= Fotos ================= */
function compressImage(file){return new Promise((res,rej)=>{const fr=new FileReader();fr.onerror=()=>rej(new UserError('No se pudo leer la foto.'));fr.onload=()=>{const img=new Image();img.onerror=()=>rej(new UserError('Ese archivo no parece una foto.'));img.onload=()=>{const max=960,sc=Math.min(1,max/img.width);const c=document.createElement('canvas');c.width=Math.round(img.width*sc);c.height=Math.round(img.height*sc);c.getContext('2d').drawImage(img,0,0,c.width,c.height);let q=.72,url=c.toDataURL('image/jpeg',q);while(url.length>420000&&q>.35){q-=.1;url=c.toDataURL('image/jpeg',q)}res(url)};img.src=fr.result};fr.readAsDataURL(file)})}


/* ================= Acciones ================= */
// Las acciones que guardan bloquean su botón mientras esperan y muestran el error si algo falla.
let pending=0; // acciones en curso (para las pruebas)
async function guardar(el,fn){
  if(el){if(el.dataset.busy)return;el.dataset.busy='1';el.disabled=true}
  pending++;
  try{return await fn()}
  catch(e){
    const ue=toUserError(e);
    if(ue.sesion||ue.permiso){logout(ue.message);return}
    if(ue.red)setOnline(false);
    else if(session&&!busy)refresh().catch(()=>{}); // trae lo último, por si la otra persona cambió algo
    showErr(ue);
  }
  finally{pending--;if(el&&el.isConnected){delete el.dataset.busy;el.disabled=false}}
}
function planEdit(el,fn,msg){
  return guardar(el,async()=>{const t=cloneTrip(tripById(modal.tripId));fn(t);await mutate('guardar_plano',{tripId:t.id,seats:t.seats});closeModal();if(msg)toast(msg)});
}
const A={
  go:el=>go(el.dataset.v),
  openTrip:el=>{closeModal();go('viaje',{tripId:el.dataset.id,tab:el.dataset.tab||'resumen',paxQ:'',payFilter:'todos',editLayout:false})},
  openClient:el=>{closeModal();go('cliente',{clientId:el.dataset.id})},
  toClient:el=>{closeModal();go('cliente',{clientId:el.dataset.id})},
  tab:el=>{ui.tab=el.dataset.tab;ui.editLayout=false;render()},
  tripFilter:el=>{ui.tripFilter=el.dataset.f;render()},
  payFilter:el=>{ui.payFilter=el.dataset.f;render()},
  listOrder:el=>{ui.listOrder=el.dataset.o;render()},
  alertsToggle:()=>{ui.allAlerts=!ui.allAlerts;render()},
  close:()=>closeModal(),
  confirmOk:()=>{const fn=modal.onOk;fn()},
  reload:()=>location.reload(),
  logout:()=>logout(),
  // Viajes
  tripNew:()=>openModal({type:'trip',wide:true,id:null,photo:undefined}),
  tripEdit:el=>openModal({type:'trip',wide:true,id:el.dataset.id,photo:undefined}),
  tripSave:el=>guardar(el,async()=>{
    const f=readTrip();
    if(!f.name.trim())fail('Escribí el nombre del viaje.');
    if(!f.departDate)fail('Indicá la fecha de salida.');
    if(!f.pickups.length)fail('Elegí al menos un lugar de subida.');
    const p=tripPayload(f,modal.id);
    if(modal.photo&&/^data:/.test(modal.photo))modal.photo=await uploadPhoto(modal.photo);
    if(modal.photo!==undefined)p.photo=modal.photo||null;
    const wasNew=!modal.id;
    const out=await mutate('guardar_viaje',p);
    closeModal();go('viaje',{tripId:out.id,tab:'resumen'});
    toast(wasNew?'Viaje creado.':out.updated?`Viaje guardado. Se actualizó el precio de ${plural(out.updated,'reserva','reservas')}${out.skipped?` (${out.skipped} no, porque ya habían pagado más)`:''}.`:'Cambios guardados.');
  }),
  tfNewPoint:()=>{const b=$('#tf-np');b.hidden=!b.hidden;if(!b.hidden)$('#tf-np-name').focus()},
  tfSavePoint:el=>guardar(el,async()=>{
    const out=await mutate('guardar_lugar',{name:$('#tf-np-name').value,address:$('#tf-np-addr').value,reference:$('#tf-np-ref').value});
    const p=pointById(out.id);
    $('#tf-pickups').insertAdjacentHTML('beforeend',pkRow(p.id,true,''));
    $('#tf-np').hidden=true;['tf-np-name','tf-np-addr','tf-np-ref'].forEach(i=>{$('#'+i).value=''});clearErr();
    toast(`Lugar “${p.name}” guardado.`);
  }),
  tfPhotoClear:()=>{modal.photo=null;const art=($('#tf-art')||{}).value;$('#tf-prev').innerHTML=illus(art);toast('Foto quitada. Guardá el viaje para confirmar.')},
  // Pasajeros
  wizard:el=>openWizard(el.dataset.trip||null,el.dataset.sid||null),
  wizTrip:el=>{const t=tripById(el.dataset.id);wizInitTrip(modal,t);modal.step=1;renderModal()},
  wizPick:el=>{modal.clientId=el.dataset.id;modal.creating=false;renderModal()},
  wizClear:()=>{modal.clientId=null;renderModal()},
  wizNewClient:()=>{modal.creating=true;modal.draft=null;const q=modal.q.trim();if(q){const d=digits(q);modal.draft=d.length>=6?{docNumber:d}:{firstName:q.split(' ')[0]||'',lastName:q.split(' ').slice(1).join(' ')}}renderModal()},
  wizCancelNew:()=>{modal.creating=false;renderModal()},
  wizSaveClient:el=>guardar(el,async()=>{
    const f=readClient('wc');modal.draft=f;
    const out=await mutate('guardar_cliente',f);
    modal.clientId=out.id;modal.creating=false;renderModal();
    toast(`Cliente ${nameOf(clientById(out.id))} guardado.`);
  }),
  wizMode:el=>{const t=tripById(modal.tripId);modal.mode=el.dataset.mode;if(!modal.priceTouched){if(modal.mode==='infant'){modal.price='0';modal.reason='Bebé'}else{modal.price=String(t.price);modal.reason=''}}rerender()},
  wizSeat:el=>{modal.seatId=el.dataset.sid;rerender()},
  wizReason:el=>{modal.reason=modal.reason===el.dataset.r?'':el.dataset.r;rerender()},
  wizNext:()=>{try{wizValidate(modal);modal.step++;renderModal()}catch(e){showErr(e)}},
  wizBack:()=>{modal.step=Math.max(1,modal.step-1);renderModal()},
  wizSave:el=>guardar(el,async()=>{
    const m=modal,t=tripById(m.tripId);
    const price=parseMoney(m.price);
    const reason=price!==t.price?[m.reason,m.reasonText.trim()].filter(Boolean).join(': '):'';
    const deposit=m.dep?{amount:parseMoney(m.depAmt),method:m.depMethod,date:m.depDate,note:m.depNote}:null;
    let out;
    try{out=await mutate('crear_reserva',{token:m.token,tripId:t.id,clientId:m.clientId,seatId:m.mode==='seat'?m.seatId:null,infantOf:m.mode==='infant'?m.infantOf:null,pickupId:m.pickupId,price,priceReason:reason,groupWith:m.mode==='seat'&&m.groupWith?m.groupWith:null,deposit})}
    catch(e){
      // Si la otra persona ocupó esa butaca mientras tanto, se vuelve al plano (ya actualizado) para elegir otra.
      const ue=toUserError(e);
      if(!ue.red&&/^La butaca .+ (ya está ocupada|está bloqueada)/.test(ue.message)&&modal===m){await refresh().catch(()=>{});m.seatId='';m.step=2;renderModal()}
      throw ue;
    }
    if(!(ui.view==='viaje'&&ui.tripId===t.id))go('viaje',{tripId:t.id,tab:'pasajeros'});
    openModal({type:'done',tripId:t.id,resId:out.id});
  }),
  doneList:()=>{const tid=modal.tripId;closeModal();go('viaje',{tripId:tid,tab:'lista'})},
  payFind:()=>openModal({type:'payFind',q:''}),
  pfPick:el=>openModal({type:'res',id:el.dataset.id,sub:'pay',direct:true}),
  // Reserva
  openRes:el=>openModal({type:'res',id:el.dataset.id,sub:null}),
  resPay:el=>openModal({type:'res',id:el.dataset.id,sub:'pay',direct:true}),
  seatMove:el=>openModal({type:'res',id:el.dataset.id,sub:'seat',sel:null}),
  sub:el=>{modal.sub=el.dataset.sub||null;modal.direct=false;modal.tok=null;modal.sel=null;modal.reason='';modal.autoAlloc=true;renderModal()},
  payDo:el=>guardar(el,async()=>{
    const r=resById(modal.id);
    if(!modal.tok)modal.tok=tok();
    const amount=parseMoney($('#pay-amt').value);
    const inputs=$$('[data-alloc]');
    const alloc=inputs.length?inputs.map(i=>({r:i.dataset.alloc,amt:parseMoney(i.value)||0})):[{r:r.id,amt:Number.isFinite(amount)?amount:0}];
    const out=await mutate('registrar_pago',{token:modal.tok,date:$('#pay-date').value,method:$('#pay-method').value,amount:Number.isFinite(amount)?amount:null,note:$('#pay-note').value,alloc,creditClientId:r.clientId});
    const direct=modal.direct;modal.sub=null;modal.tok=null;
    if(direct)closeModal();else renderModal();
    const rr=resById(r.id);
    toast(out&&out.repetido?'Ese pago ya estaba registrado.':`Pago de ${money(amount)} registrado. Saldo de ${nameOf(clientById(r.clientId))}: ${money(balanceOf(rr))}.`);
  }),
  voidAsk:el=>{modal.sub='void';modal.pid=el.dataset.pid;renderModal()},
  voidDo:el=>guardar(el,async()=>{await mutate('anular_pago',{id:modal.pid,reason:$('#void-reason').value});modal.sub=null;renderModal();toast('Pago anulado. Queda en el historial.')}),
  mvSeat:el=>{modal.sel=el.dataset.sid;rerender()},
  mvDo:el=>guardar(el,async()=>{
    await mutate('cambiar_butaca',{resId:modal.id,seatId:modal.sel});
    const r=resById(modal.id),t=tripById(r.tripId);
    modal.sub=null;modal.sel=null;renderModal();
    toast(`Ahora está en la butaca ${seatLabel(t,r.seatId)}.`);
  }),
  pickupDo:el=>guardar(el,async()=>{const v=($('input[name="pk-new"]:checked')||{}).value;await mutate('cambiar_subida',{resId:modal.id,pointId:v});modal.sub=null;renderModal();toast('Lugar de subida actualizado.')}),
  priceReason:el=>{const keepV=$('#price-new').value,keepD=$('#price-detail').value;modal.reason=modal.reason===el.dataset.r?'':el.dataset.r;rerender();$('#price-new').value=keepV;$('#price-detail').value=keepD},
  priceDo:el=>guardar(el,async()=>{
    const reason=[modal.reason,$('#price-detail').value.trim()].filter(Boolean).join(': ');
    const v=parseMoney($('#price-new').value);
    await mutate('cambiar_precio',{resId:modal.id,price:Number.isFinite(v)?v:null,reason});
    modal.sub=null;modal.reason='';renderModal();toast('Precio actualizado.');
  }),
  groupJoin:el=>guardar(el,async()=>{const v=$('#group-with').value;if(!v)fail('Elegí con quién paga.');await mutate('unir_grupo',{resId:modal.id,otherId:v});modal.sub=null;renderModal();toast('Grupo actualizado.')}),
  groupLeave:el=>guardar(el,async()=>{await mutate('salir_grupo',{resId:modal.id});modal.sub=null;renderModal();toast('Ahora paga por su cuenta.')}),
  infantDo:el=>guardar(el,async()=>{await mutate('cambiar_adulto',{resId:modal.id,adultId:$('#infant-adult').value});modal.sub=null;renderModal();toast('Actualizado.')}),
  cancelDo:el=>guardar(el,async()=>{
    const out=await mutate('dar_de_baja',{resId:modal.id,reason:$('#c-reason').value,withInfants:!!($('#c-inf')||{}).checked,...readMoney('c')});
    modal.sub=null;renderModal();
    toast(out.count>1?`Se dieron de baja ${out.count} reservas. La butaca quedó libre.`:'Reserva dada de baja. La butaca quedó libre.');
  }),
  resolveDo:el=>guardar(el,async()=>{await mutate('resolver_baja',{resId:modal.id,...readMoney('rs')});modal.sub=null;renderModal();toast('Dinero de la baja resuelto.')}),
  // Butacas
  seatInfo:el=>openModal({type:'seat',tripId:ui.tripId,sid:el.dataset.sid}),
  seatBlock:()=>{modal.blocking=true;renderModal()},
  seatBlockDo:el=>guardar(el,async()=>{const reason=($('input[name="blk-r"]:checked')||{}).value;await mutate('bloquear_butaca',{tripId:modal.tripId,seatId:modal.sid,reason,name:$('#blk-name').value});closeModal();toast('Butaca bloqueada.')}),
  seatUnblock:el=>guardar(el,async()=>{await mutate('desbloquear_butaca',{tripId:modal.tripId,seatId:modal.sid});closeModal();toast('Butaca desbloqueada.')}),
  edStart:()=>{ui.editLayout=true;render()},
  edDone:()=>{ui.editLayout=false;render()},
  edSeat:el=>openModal({type:'edSeat',tripId:ui.tripId,sid:el.dataset.sid}),
  edAdd:el=>openModal({type:'edAdd',tripId:ui.tripId,floor:el.dataset.floor,r:+el.dataset.r,c:+el.dataset.c}),
  edNumDo:el=>planEdit(el,t=>_renumberSeat(t,modal.sid,$('#ed-num').value)),
  edRemove:el=>planEdit(el,t=>_removeSeat(t,modal.sid),'Butaca quitada.'),
  edAddDo:el=>planEdit(el,t=>_addSeat(t,modal.floor,modal.r,modal.c,$('#ed-num').value),'Butaca agregada.'),
  edRenumber:()=>openModal({type:'edRenumber',tripId:ui.tripId}),
  edRenumberDo:el=>planEdit(el,t=>_autoNumber(t,($('input[name="ren-o"]:checked')||{}).value||'alta'),'Butacas numeradas de nuevo.'),
  edConfirm:el=>guardar(el,async()=>{const v=el.dataset.v==='1';await mutate('guardar_plano',{tripId:ui.tripId,confirmed:v});toast(v?'Plano marcado como confirmado.':'El plano vuelve a ser aproximado.')}),
  edModel:()=>openModal({type:'edModel',tripId:ui.tripId}),
  edModelDo:el=>guardar(el,async()=>{const out=await mutate('guardar_modelo',{tripId:modal.tripId,name:$('#model-name').value});closeModal();toast(`Plano “${out.name}” guardado.`)}),
  // Lista
  print:()=>{const t=tripById(ui.tripId);$('#print-root').innerHTML=sheetHTML(t);window.print()},
  pdf:async el=>{const t=tripById(ui.tripId);el.disabled=true;try{const blob=await makePdf(t);await deliverFile(pdfName(t),blob)}catch(e){console.error(e);toast('No se pudo armar el PDF. Probá de nuevo.','bad')}finally{el.disabled=false}},
  // Clientes
  clientNew:()=>openModal({type:'client',wide:true,id:null}),
  clientEdit:el=>openModal({type:'client',wide:true,id:el.dataset.id}),
  clientSave:el=>guardar(el,async()=>{
    const id=modal.id;
    const out=await mutate('guardar_cliente',{...readClient('cf'),id});
    closeModal();go('cliente',{clientId:out.id});toast(id?'Datos actualizados.':'Cliente creado.');
  }),
  // Configuración
  pointNew:()=>openModal({type:'point',id:null}),
  pointEdit:el=>openModal({type:'point',id:el.dataset.id}),
  pointSave:el=>guardar(el,async()=>{await mutate('guardar_lugar',{id:modal.id,name:$('#pt-name').value,address:$('#pt-addr').value,reference:$('#pt-ref').value});closeModal();toast('Lugar de subida guardado.')}),
  pointDelete:el=>guardar(el,async()=>{await mutate('borrar_lugar',{id:modal.id});closeModal();toast('Lugar borrado.')}),
  methodAdd:el=>guardar(el,async()=>{
    const v=$('#method-new').value.trim();
    if(!v)fail('Escribí el nombre del medio de pago.');
    if(norm(v)===norm(CREDIT)||S.methods.some(m=>norm(m)===norm(v)))fail('Ese medio de pago ya existe.');
    await mutate('guardar_medios',{methods:[...S.methods,v]});toast('Medio de pago agregado.');
  }),
  methodRemove:el=>guardar(el,async()=>{if(S.methods.length<=1)fail('Tiene que quedar al menos un medio de pago.');await mutate('guardar_medios',{methods:S.methods.filter(m=>m!==el.dataset.m)});toast('Medio de pago quitado.')}),
  modelDelete:el=>guardar(el,async()=>{await mutate('borrar_modelo',{id:el.dataset.id});toast('Plano borrado.')}),
  shareFile:el=>guardar(el,async()=>{const m=modal;try{await navigator.share({files:[m.file],title:m.file.name})}catch(e){if(e&&e.name==='AbortError')return;fail('No se pudo compartir. Probá con «Descargar».')}closeModal();if(m.onDone)await m.onDone()}),
  saveFile:async()=>{const m=modal;closeModal();downloadBlob(m.file.name,m.file,m.okMsg);if(m.onDone)await m.onDone()},
  passNew:()=>openModal({type:'pass'}),
  passDo:el=>guardar(el,async()=>{
    const a=$('#pw-1').value,b=$('#pw-2').value;
    if(a.length<8)fail('La contraseña tiene que tener al menos 8 letras o números.');
    if(a!==b)fail('Las dos contraseñas no son iguales.');
    let res;try{res=await sb.auth.updateUser({password:a})}catch(e){throw toUserError(e)}
    if(res.error){
      const c=res.error.code||'',m=String(res.error.message||'');
      if(c==='same_password'||/same/i.test(m))fail('Es igual a la contraseña que ya tenías. Elegí otra.');
      if(c==='weak_password'||/weak|at least/i.test(m))fail('Esa contraseña es muy fácil de adivinar. Probá con una más larga.');
      if(c==='reauthentication_needed')fail('Por seguridad, tocá Salir, volvé a entrar y cambiala enseguida.');
      throw toUserError(res.error);
    }
    closeModal();toast('Contraseña cambiada. La próxima vez entrá con la nueva.');
  }),
  exportExcel:el=>guardar(el,async()=>{try{await downloadExcel()}catch(e){if(e instanceof UserError)throw e;console.error(e);fail('No se pudo armar el Excel. Probá de nuevo.')}}),
  exportJson:el=>guardar(el,()=>downloadJson())
};

/* ================= Eventos ================= */
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-act]');if(!el||el.disabled)return;
  const fn=A[el.dataset.act];if(!fn)return;
  e.preventDefault();
  try{const out=fn(el,e);if(out&&out.catch)out.catch(showErr)}catch(err){showErr(err)}
});
function payAmtChanged(){
  const v=parseMoney($('#pay-amt').value);$('#pay-fmt').textContent=v>0?money(v):'';
  const inputs=$$('[data-alloc]');if(!inputs.length)return;
  if(modal.autoAlloc!==false){let left=v>0?v:0;inputs.forEach(i=>{const bal=balanceOf(resById(i.dataset.alloc));const a=Math.min(bal,left);left-=a;i.value=a>0?NUM.format(a):''})}
  allocSum();
}
function allocSum(){const el=$('#alloc-sum');if(!el)return;const v=parseMoney($('#pay-amt').value)||0;const s=$$('[data-alloc]').reduce((x,i)=>x+(parseMoney(i.value)||0),0);el.innerHTML=s===v?`Repartido: <b>${money(s)}</b>`:`Repartido: <b>${money(s)}</b> de ${money(v)}. <span style="color:var(--bad)">Tiene que sumar lo mismo que el pago.</span>`}
function bindEffects(key,el){
  const m=modal;
  if(m.type==='wiz'){
    if(key==='q'){const t=tripById(m.tripId);$('#w-results').innerHTML=wizResults(m,t)}
    if(key==='price'){m.priceTouched=true;const t=tripById(m.tripId);const box=$('#w-reason');if(box)box.hidden=parseMoney(m.price)===t.price}
    if(key==='dep'){const b=$('#w-dep');if(b)b.hidden=!m.dep}
  }
  if(m.type==='payFind'&&key==='q')$('#pf-results').innerHTML=payFindResults(m);
}
function onField(e){
  const el=e.target;
  if(el.id==='client-q'){ui.clientQ=el.value;$('#client-list').innerHTML=clientRows();return}
  if(el.id==='pax-q'){ui.paxQ=el.value;$('#pax-list').innerHTML=paxRows(tripById(ui.tripId));return}
  if(modal&&el.dataset.bind){modal[el.dataset.bind]=el.type==='checkbox'?el.checked:el.value;bindEffects(el.dataset.bind,el);return}
  if(el.id==='pay-amt'){payAmtChanged();return}
  if(el.dataset.alloc){modal.autoAlloc=false;allocSum();return}
  if(el.id==='tf-price'&&modal&&modal.id){const t=tripById(modal.id);const w=$('#tf-apply-wrap');if(w)w.hidden=parseMoney(el.value)===t.price||!tripRes(t.id).length;return}
  if(el.id==='tf-dd'||el.id==='tf-rd'){const dd=$('#tf-dd').value,rd=$('#tf-rd').value;$('#tf-dur').textContent=dd&&rd&&rd>dd?durationLabel({departDate:dd,returnDate:rd}):dd&&rd&&rd<dd?'El regreso es anterior a la salida.':'Salida de un día (si vuelve el mismo día, dejala vacía).';return}
}
document.addEventListener('input',onField);
document.addEventListener('change',e=>{
  const el=e.target;
  if(el.id==='caja-trip'){ui.cajaTrip=el.value;render();return}
  if(el.id==='list-blocked'){ui.listBlocked=el.checked;render();return}
  if(el.name==='tf-type'){$('#tf-lower-wrap').hidden=el.value!=='micro2';return}
  if(el.id==='tf-model'){const dis=!!el.value;$$('input[name="tf-type"]').forEach(x=>{x.disabled=dis});$('#tf-cap').disabled=dis;$('#tf-lower').disabled=dis;return}
  if(el.id==='tf-art'){if(!modal.photo&&!(modal.photo===undefined&&modal.id&&tripById(modal.id).photo))$('#tf-prev').innerHTML=illus(el.value);return}
  if(el.id==='tf-photo'){const f=el.files&&el.files[0];if(!f)return;compressImage(f).then(url=>{modal.photo=url;$('#tf-prev').innerHTML=`<img src="${url}" alt="Foto elegida">`;toast('Foto lista. Guardá el viaje para confirmarla.')}).catch(showErr);return}
  if(el.id==='wc-dtype'||el.id==='cf-dtype'){const p=el.id.split('-')[0];$('#'+p+'-dcountry-wrap').hidden=el.value!=='Pasaporte';$('#'+p+'-dnum').inputMode=el.value==='Pasaporte'?'text':'numeric';return}
  if(el.name==='c-money'||el.name==='rs-money'){const p=el.name.split('-')[0];$('#'+p+'-refund').hidden=el.value!=='devuelto';return}
  if(modal&&el.dataset.bind&&el.type!=='text'&&el.type!=='search'){modal[el.dataset.bind]=el.type==='checkbox'?el.checked:el.value;bindEffects(el.dataset.bind,el)}
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&modal&&!['wiz','trip','client'].includes(modal.type)){closeModal()}
  if(e.key==='Enter'&&modal&&e.target.matches('#pay-amt,#pay-note,#void-reason,#ed-num,#model-name,#pt-name')){e.preventDefault();const b=$('#modal .dlg-foot .btn:last-child');if(b&&!b.disabled)b.click()}
});


/* ================= Inicio ================= */
document.addEventListener('submit',e=>{if(e.target&&e.target.id==='login-form'){e.preventDefault();doLogin()}});
// Mostrar u ocultar lo que se escribe en las contraseñas
document.addEventListener('change',e=>{
  const id=e.target&&e.target.id,show=!!e.target.checked;
  if(id==='login-show')$('#login-pass').type=show?'text':'password';
  if(id==='pw-show')['#pw-1','#pw-2'].forEach(s=>{const i=$(s);if(i)i.type=show?'text':'password'});
});
async function boot(){
  $$('img.emblem').forEach(i=>{i.src='img/logo-192.png'});
  try{
    if(window.NV_CREATE_CLIENT)sb=window.NV_CREATE_CLIENT();
    else if(window.supabase&&CFG.supabaseUrl&&CFG.supabaseKey)sb=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'nv-sesion'}});
  }catch(e){console.error(e)}
  if(!sb){showScreen('fatal','Falta configurar la conexión con la base de datos.');return}
  sb.auth.onAuthStateChange((ev,s)=>{if(ev==='SIGNED_OUT'&&session)logout('La sesión se cerró. Volvé a entrar.');else if(s)session=s});
  let s=null;
  try{const r=await sb.auth.getSession();s=r&&r.data?r.data.session:null}catch(e){}
  session=s;
  if(session)await enter();else showScreen('login');
}
boot();
getDownloads().then(ns=>{dlState=ns?'yes':'no';if(ui.view==='viaje'&&ui.tab==='lista')safeRender()});
if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost'))navigator.serviceWorker.register('sw.js').catch(()=>{});
window.NV={get S(){return S},get pending(){return pending},get busy(){return busy},get online(){return online},ui,call,mutate,refresh,paidOf,balanceOf,clientCreditLeft,tripCounts,listData,makePdf,backupRows};
