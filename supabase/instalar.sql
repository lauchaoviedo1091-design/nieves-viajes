-- =====================================================================
--  NIEVES VIAJES · Base de datos (Supabase / PostgreSQL)
--  Versión 1 · Etapa 2
--
--  Crea las tablas, la seguridad y las funciones que usa la app.
--  Nadie puede leer ni escribir las tablas directamente desde internet:
--  la app solo llama a las funciones de abajo, que primero verifican que
--  quien llama esté en la tabla "usuarios" y después validan cada dato.
--  Todas las escrituras se hacen de a una (en fila), así dos personas
--  nunca pueden ocupar la misma butaca ni duplicar un pago.
-- =====================================================================

create schema if not exists privado;
revoke all on schema privado from public;
grant usage on schema privado to authenticated;

-- ---------------------------------------------------------------------
-- 1. Funciones de ayuda (no tocan tablas)
-- ---------------------------------------------------------------------

create or replace function privado.normalizar(t text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(lower(translate(coalesce(t, ''),
    'ÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãåéèêëíìîïóòôöõúùûüñç',
    'AAAAAAEEEEIIIIOOOOOUUUUNCaaaaaaeeeeiiiiooooouuuunc')), '\s+', ' ', 'g'))
$$;

-- Clave para no repetir documentos: DNI sin ceros adelante; pasaporte con país.
create or replace function privado.clave_doc(tipo text, numero text, pais text) returns text
language sql immutable set search_path = '' as $$
  select case
    when x.n = '' then null
    when tipo = 'Pasaporte' then 'P|' || privado.normalizar(pais) || '|' || x.n
    else 'D|' || coalesce(nullif(ltrim(x.n, '0'), ''), '0')
  end
  from (select regexp_replace(upper(coalesce(numero, '')), '[^0-9A-Z]', '', 'g') as n) as x
$$;

create or replace function privado.dinero(n bigint) returns text
language sql stable set search_path = '' as $$
  select '$ ' || replace(to_char(coalesce(n, 0), 'FM999,999,999,990'), ',', '.')
$$;

create or replace function privado.plural(n bigint, uno text, varios text) returns text
language sql immutable set search_path = '' as $$
  select n::text || ' ' || case when n = 1 then uno else varios end
$$;

create or replace function privado.hoy() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date
$$;

create or replace function privado.ahora() returns text
language sql stable set search_path = '' as $$
  select to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD"T"HH24:MI')
$$;

create or replace function privado.ts(t timestamptz) returns text
language sql stable set search_path = '' as $$
  select to_char(t at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD"T"HH24:MI')
$$;

-- Error para mostrarle a la persona (la app muestra el mensaje tal cual).
create or replace function privado.error(msg text, pista text default 'nv', detalle text default '') returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = msg, hint = pista, detail = detalle;
end $$;

create or replace function privado.id(t text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  if t is null or btrim(t) = '' then return null; end if;
  return btrim(t)::uuid;
exception when others then
  return null;
end $$;

create or replace function privado.fecha(t text, msg text default 'Revisá la fecha: no es válida.') returns date
language plpgsql stable set search_path = '' as $$
declare d date;
begin
  if t is null or btrim(t) = '' then return null; end if;
  if btrim(t) !~ '^\d{4}-\d{2}-\d{2}$' then perform privado.error(msg); end if;
  begin
    d := btrim(t)::date;
  exception when others then
    perform privado.error(msg);
  end;
  return d;
end $$;

-- Importe entero en pesos (sin centavos).
create or replace function privado.importe(v jsonb, msg text, minimo bigint default 0) returns bigint
language plpgsql stable set search_path = '' as $$
declare n numeric;
begin
  if v is null or jsonb_typeof(v) <> 'number' then perform privado.error(msg); end if;
  n := (v #>> '{}')::numeric;
  if n <> trunc(n) or n < minimo or n > 99999999999 then perform privado.error(msg); end if;
  return n::bigint;
end $$;

create or replace function privado.limpio(v text, n int default 500) returns text
language sql immutable set search_path = '' as $$
  select left(btrim(coalesce(v, '')), n)
$$;

create or replace function privado.hora(v text) returns text
language sql immutable set search_path = '' as $$
  select case when btrim(coalesce(v, '')) ~ '^([01]\d|2[0-3]):[0-5]\d$' then btrim(v) else '' end
$$;

create or replace function privado.si(v jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(v = 'true'::jsonb, false)
$$;

-- Revisa un plano de butacas y lo devuelve limpio.
create or replace function privado.validar_butacas(b jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  s jsonb;
  k text;
  nums text[] := '{}';
  ids text[] := '{}';
  pos text[] := '{}';
begin
  if b is null or jsonb_typeof(b) <> 'array' or jsonb_array_length(b) = 0 then
    perform privado.error('El plano necesita al menos una butaca.');
  end if;
  if jsonb_array_length(b) > 150 then
    perform privado.error('El plano no puede tener más de 150 butacas.');
  end if;
  for s in select x from jsonb_array_elements(b) as x loop
    if jsonb_typeof(s) <> 'object'
       or coalesce(s ->> 'id', '') !~ '^[A-Za-z0-9_-]{1,40}$'
       or coalesce(s ->> 'floor', '') not in ('alta', 'baja', 'unica')
       or jsonb_typeof(s -> 'r') is distinct from 'number'
       or jsonb_typeof(s -> 'c') is distinct from 'number' then
      perform privado.error('El plano de butacas no es válido.');
    end if;
    if (s ->> 'r')::numeric <> trunc((s ->> 'r')::numeric) or (s ->> 'r')::numeric not between 0 and 60
       or (s ->> 'c')::numeric <> trunc((s ->> 'c')::numeric) or (s ->> 'c')::numeric not between 0 and 8 then
      perform privado.error('El plano de butacas no es válido.');
    end if;
    if coalesce(s ->> 'num', '') !~ '^[0-9A-Z]{1,4}$' then
      perform privado.error('El número de butaca puede tener hasta 4 números o letras.');
    end if;
    if (s ->> 'num') = any(nums) then
      perform privado.error(format('Ya hay otra butaca con el número %s.', s ->> 'num'));
    end if;
    if (s ->> 'id') = any(ids) then
      perform privado.error('El plano de butacas no es válido.');
    end if;
    k := (s ->> 'floor') || ':' || (s ->> 'r') || ':' || (s ->> 'c');
    if k = any(pos) then
      perform privado.error('Ese lugar ya tiene una butaca.');
    end if;
    nums := nums || (s ->> 'num');
    ids := ids || (s ->> 'id');
    pos := pos || k;
  end loop;
  return (
    select jsonb_agg(jsonb_build_object(
             'id', e.x ->> 'id', 'floor', e.x ->> 'floor',
             'r', (e.x ->> 'r')::numeric::int, 'c', (e.x ->> 'c')::numeric::int,
             'num', e.x ->> 'num') order by e.o)
      from jsonb_array_elements(b) with ordinality as e(x, o)
  );
end $$;

-- ---------------------------------------------------------------------
-- 2. Tablas
-- ---------------------------------------------------------------------

create table public.usuarios (
  email      text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  nombre     text not null check (btrim(nombre) <> ''),
  creado_en  timestamptz not null default clock_timestamp()
);
comment on table public.usuarios is 'Personas autorizadas a usar la app (por mail). Solo ellas ven y cargan datos.';

create table public.config (
  id       int primary key default 1 check (id = 1),
  medios   text[] not null default array['Efectivo', 'Transferencia', 'Mercado Pago']::text[],
  version  bigint not null default 0,
  ultima_copia      timestamptz,
  ultima_copia_por  text
);
comment on table public.config is 'Preferencias generales. "version" sube con cada cambio para que los otros dispositivos se actualicen.';
insert into public.config (id) values (1);

create table public.operaciones (
  token      text primary key,
  resultado  jsonb not null,
  creado_en  timestamptz not null default clock_timestamp()
);
comment on table public.operaciones is 'Evita guardar dos veces la misma operación (por ejemplo, un doble toque en "Registrar pago").';

create table public.lugares (
  id          uuid primary key default gen_random_uuid(),
  orden       bigint generated always as identity,
  nombre      text not null check (btrim(nombre) <> ''),
  direccion   text not null default '',
  referencia  text not null default '',
  creado_en   timestamptz not null default clock_timestamp()
);
comment on table public.lugares is 'Lugares de subida habituales.';

create table public.clientes (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null check (btrim(nombre) <> ''),
  apellido           text not null check (btrim(apellido) <> ''),
  nacimiento         date,
  doc_tipo           text not null default 'DNI' check (doc_tipo in ('DNI', 'Pasaporte')),
  doc_numero         text not null default '',
  doc_pais           text not null default '',
  telefono           text not null default '',
  emergencia_nombre  text not null default '',
  emergencia_tel     text not null default '',
  notas              text not null default '',
  doc_clave          text generated always as (privado.clave_doc(doc_tipo, doc_numero, doc_pais)) stored,
  creado_en          timestamptz not null default clock_timestamp(),
  creado_por         text not null default '',
  actualizado_en     timestamptz,
  actualizado_por    text
);
create unique index clientes_doc_unico on public.clientes (doc_clave) where doc_clave is not null;
comment on table public.clientes is 'Datos de cada persona. Se reutilizan en cada viaje.';

create table public.viajes (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null check (btrim(nombre) <> ''),
  origen            text not null default 'Rosario',
  provincia         text not null default '',
  ciudad            text not null default '',
  salida_fecha      date not null,
  salida_hora       text not null default '',
  regreso_fecha     date check (regreso_fecha is null or regreso_fecha >= salida_fecha),
  regreso_hora      text not null default '',
  hotel             text not null default '',
  comidas           text not null default '',
  incluye           text not null default '',
  notas             text not null default '',
  dibujo            text not null default 'sierras',
  foto              text,
  precio            bigint not null check (precio >= 0),
  vehiculo          text not null check (vehiculo in ('combi', 'micro1', 'micro2')),
  plano_confirmado  boolean not null default false,
  butacas           jsonb not null check (jsonb_typeof(butacas) = 'array'),
  bloqueos          jsonb not null default '[]'::jsonb check (jsonb_typeof(bloqueos) = 'array'),
  subidas           jsonb not null default '[]'::jsonb check (jsonb_typeof(subidas) = 'array'),
  creado_en         timestamptz not null default clock_timestamp(),
  creado_por        text not null default '',
  actualizado_en    timestamptz,
  actualizado_por   text
);
comment on table public.viajes is 'Cada salida. Incluye el plano de butacas, los bloqueos y los lugares de subida.';

create table public.grupos (
  id        uuid primary key default gen_random_uuid(),
  viaje_id  uuid not null references public.viajes(id) on delete cascade,
  nombre    text not null
);
comment on table public.grupos is 'Pasajeros de un mismo viaje que pagan juntos.';

create table public.reservas (
  id            uuid primary key default gen_random_uuid(),
  viaje_id      uuid not null references public.viajes(id),
  cliente_id    uuid not null references public.clientes(id),
  butaca_id     text,
  en_brazos_de  uuid references public.reservas(id),
  subida_id     uuid references public.lugares(id) on delete set null,
  precio        bigint not null check (precio >= 0),
  estado        text not null default 'activa' check (estado in ('activa', 'cancelada')),
  grupo_id      uuid references public.grupos(id) on delete set null,
  precio_log    jsonb not null default '[]'::jsonb,
  butaca_log    jsonb not null default '[]'::jsonb,
  baja          jsonb,
  creado_en     timestamptz not null default clock_timestamp(),
  creado_por    text not null default ''
);
create unique index reservas_una_por_butaca on public.reservas (viaje_id, butaca_id)
  where estado = 'activa' and butaca_id is not null;
create unique index reservas_una_por_cliente on public.reservas (viaje_id, cliente_id)
  where estado = 'activa';
create index reservas_cliente on public.reservas (cliente_id);
comment on table public.reservas is 'Cada pasajero en cada viaje: butaca, subida, precio acordado y estado.';

create table public.pagos (
  id              uuid primary key default gen_random_uuid(),
  fecha           date not null,
  medio           text not null,
  importe         bigint not null check (importe > 0),
  nota            text not null default '',
  estado          text not null default 'valido' check (estado in ('valido', 'anulado')),
  anulado_motivo  text,
  anulado_en      timestamptz,
  anulado_por     text,
  creado_en       timestamptz not null default clock_timestamp(),
  creado_por      text not null default ''
);
comment on table public.pagos is 'Cobros. Nunca se borran: un error se anula con motivo.';

create table public.pago_partes (
  pago_id     uuid not null references public.pagos(id) on delete cascade,
  reserva_id  uuid not null references public.reservas(id),
  importe     bigint not null check (importe > 0),
  orden       int not null default 0,
  primary key (pago_id, reserva_id)
);
create index pago_partes_reserva on public.pago_partes (reserva_id);
comment on table public.pago_partes is 'A qué reserva va cada parte de un pago (un pago de grupo se reparte).';

create table public.saldos (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references public.clientes(id),
  importe         bigint not null check (importe > 0),
  reserva_origen  uuid references public.reservas(id),
  creado_en       timestamptz not null default clock_timestamp(),
  creado_por      text not null default ''
);
create index saldos_cliente on public.saldos (cliente_id);
comment on table public.saldos is 'Saldo a favor que queda de una baja. Se usa una sola vez.';

create table public.pago_saldos (
  pago_id   uuid not null references public.pagos(id) on delete cascade,
  saldo_id  uuid not null references public.saldos(id),
  importe   bigint not null check (importe > 0),
  primary key (pago_id, saldo_id)
);
create index pago_saldos_saldo on public.pago_saldos (saldo_id);

create table public.devoluciones (
  id          uuid primary key default gen_random_uuid(),
  reserva_id  uuid not null references public.reservas(id),
  cliente_id  uuid not null references public.clientes(id),
  importe     bigint not null check (importe > 0),
  fecha       date not null,
  medio       text not null,
  nota        text not null default '',
  creado_en   timestamptz not null default clock_timestamp(),
  creado_por  text not null default ''
);
comment on table public.devoluciones is 'Dinero devuelto por una baja.';

create table public.planos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (btrim(nombre) <> ''),
  tipo       text not null check (tipo in ('combi', 'micro1', 'micro2')),
  butacas    jsonb not null check (jsonb_typeof(butacas) = 'array'),
  creado_en  timestamptz not null default clock_timestamp()
);
comment on table public.planos is 'Planos de vehículos guardados para reutilizar.';

-- ---------------------------------------------------------------------
-- 3. Funciones de ayuda que leen tablas
-- ---------------------------------------------------------------------

create or replace function privado.nombre_usuario() returns text
language sql stable security definer set search_path = '' as $$
  select u.nombre from public.usuarios as u
   where u.email = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
$$;

create or replace function privado.es_usuario() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.usuarios as u
     where u.email = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
  )
$$;

create or replace function privado.exigir_usuario() returns text
language plpgsql stable security definer set search_path = '' as $$
declare n text;
begin
  n := privado.nombre_usuario();
  if n is null then
    perform privado.error('Tu usuario no tiene permiso para usar esta app.', 'nv_permiso');
  end if;
  return n;
end $$;

-- Toda escritura empieza acá: verifica el permiso y espera su turno.
create or replace function privado.inicio_escritura() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare n text;
begin
  n := privado.exigir_usuario();
  perform 1 from public.config where id = 1 for update;
  return n;
end $$;

create or replace function privado.fin_escritura() returns void
language sql volatile security definer set search_path = '' as $$
  update public.config set version = version + 1 where id = 1;
$$;

create or replace function privado.token_previo(tok text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select o.resultado from public.operaciones as o where o.token = tok
$$;

create or replace function privado.guardar_token(tok text, res jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if tok is null or btrim(tok) = '' then return; end if;
  insert into public.operaciones (token, resultado) values (left(tok, 80), res)
  on conflict (token) do nothing;
end $$;

create or replace function privado.pagado(res uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(pp.importe), 0)::bigint
    from public.pago_partes as pp
    join public.pagos as pg on pg.id = pp.pago_id
   where pp.reserva_id = res and pg.estado = 'valido'
$$;

create or replace function privado.saldo_usado(s uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(ps.importe), 0)::bigint
    from public.pago_saldos as ps
    join public.pagos as pg on pg.id = ps.pago_id
   where ps.saldo_id = s and pg.estado = 'valido'
$$;

create or replace function privado.butaca(v public.viajes, sid text) returns jsonb
language sql stable set search_path = '' as $$
  select x from jsonb_array_elements(v.butacas) as x where x ->> 'id' = sid limit 1
$$;

create or replace function privado.etiqueta(b jsonb) returns text
language sql immutable set search_path = '' as $$
  select case when b is null then null
              when b ->> 'floor' = 'baja' then (b ->> 'num') || ' (PB)'
              else b ->> 'num' end
$$;

create or replace function privado.verificar_butaca_libre(v public.viajes, sid text, excepto uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  b jsonb;
  bl jsonb;
  quien text;
begin
  b := privado.butaca(v, sid);
  if b is null then perform privado.error('Elegí una butaca en el plano.'); end if;
  select x into bl from jsonb_array_elements(v.bloqueos) as x where x ->> 'seatId' = sid limit 1;
  if bl is not null then
    perform privado.error(format('La butaca %s está bloqueada (%s).', b ->> 'num', coalesce(nullif(bl ->> 'reason', ''), 'Coordinación')));
  end if;
  select c.nombre || ' ' || c.apellido into quien
    from public.reservas as r join public.clientes as c on c.id = r.cliente_id
   where r.viaje_id = v.id and r.estado = 'activa' and r.butaca_id = sid
     and (excepto is null or r.id <> excepto)
   limit 1;
  if quien is not null then
    perform privado.error(format('La butaca %s ya está ocupada por %s.', b ->> 'num', quien));
  end if;
  return b;
end $$;

create or replace function privado.salir_grupo(rid uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  g uuid;
  resto int;
begin
  select grupo_id into g from public.reservas where id = rid;
  if g is null then return; end if;
  update public.reservas set grupo_id = null where id = rid;
  select count(*) into resto from public.reservas where grupo_id = g and estado = 'activa';
  if resto <= 1 then
    update public.reservas set grupo_id = null where grupo_id = g;
    delete from public.grupos where id = g;
  end if;
end $$;

create or replace function privado.unir_grupo(rid uuid, otra uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.reservas%rowtype;
  o public.reservas%rowtype;
  g uuid;
  ape text;
begin
  select * into r from public.reservas where id = rid;
  select * into o from public.reservas where id = otra;
  if o.id is null or o.viaje_id <> r.viaje_id or o.estado <> 'activa' then
    perform privado.error('Elegí un pasajero activo de este viaje.');
  end if;
  if o.id = r.id then perform privado.error('Elegí a otra persona del viaje.'); end if;
  if r.grupo_id is not null and r.grupo_id = o.grupo_id then return; end if;
  perform privado.salir_grupo(r.id);
  select grupo_id into g from public.reservas where id = o.id;
  if g is null then
    select apellido into ape from public.clientes where id = o.cliente_id;
    insert into public.grupos (viaje_id, nombre) values (o.viaje_id, 'Grupo ' || ape) returning id into g;
    update public.reservas set grupo_id = g where id = o.id;
  end if;
  update public.reservas set grupo_id = g where id = r.id;
end $$;

-- Registra un pago (lo usan "registrar_pago" y la seña de "crear_reserva").
create or replace function privado.pago_interno(u text, p jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_fecha   date;
  v_medio   text := privado.limpio(p ->> 'method', 60);
  v_total   bigint;
  v_suma    bigint;
  v_reparto jsonb;
  v_pago    uuid;
  a         jsonb;
  r         public.reservas%rowtype;
  v_quien   text;
  v_saldo   bigint;
  v_cli     uuid;
  v_falta   bigint;
  v_disp    bigint;
  v_tomar   bigint;
  v_usos    jsonb := '[]'::jsonb;
  cr        record;
begin
  v_fecha := privado.fecha(p ->> 'date', 'Indicá la fecha del pago.');
  if v_fecha is null then perform privado.error('Indicá la fecha del pago.'); end if;
  if v_fecha > privado.hoy() then perform privado.error('La fecha del pago no puede ser futura.'); end if;
  if v_medio = '' then perform privado.error('Elegí el medio de pago.'); end if;
  v_total := privado.importe(p -> 'amount', 'Escribí el importe, mayor a cero.', 1);

  select jsonb_agg(jsonb_build_object('r', z.rid, 'amt', z.amt) order by z.ord), coalesce(sum(z.amt), 0)
    into v_reparto, v_suma
    from (
      select privado.id(e.x ->> 'r') as rid,
             sum(case when jsonb_typeof(e.x -> 'amt') = 'number' then floor((e.x ->> 'amt')::numeric) else 0 end)::bigint as amt,
             min(e.ord) as ord
        from jsonb_array_elements(case when jsonb_typeof(p -> 'alloc') = 'array' then p -> 'alloc' else '[]'::jsonb end)
             with ordinality as e(x, ord)
       group by 1
    ) as z
   where z.amt > 0;
  if v_reparto is null then perform privado.error('Indicá a qué reserva corresponde el pago.'); end if;
  if v_suma <> v_total then
    perform privado.error(format('El reparto suma %s y el pago es de %s. Tienen que coincidir.',
      privado.dinero(v_suma), privado.dinero(v_total)));
  end if;

  for a in select x from jsonb_array_elements(v_reparto) as x loop
    select * into r from public.reservas where id = privado.id(a ->> 'r') for update;
    if r.id is null or r.estado <> 'activa' then
      perform privado.error('Una de las reservas ya no está activa.');
    end if;
    v_saldo := r.precio - privado.pagado(r.id);
    if (a ->> 'amt')::bigint > v_saldo then
      select c.nombre || ' ' || c.apellido into v_quien from public.clientes as c where c.id = r.cliente_id;
      perform privado.error(format('El pago supera el saldo de %s, que es de %s.', v_quien, privado.dinero(v_saldo)));
    end if;
  end loop;

  if v_medio = 'Saldo a favor' then
    v_cli := privado.id(p ->> 'creditClientId');
    v_falta := v_total;
    for cr in
      select s.id, s.importe - privado.saldo_usado(s.id) as libre
        from public.saldos as s
       where s.cliente_id = v_cli
       order by s.creado_en
         for update
    loop
      continue when cr.libre <= 0;
      v_tomar := least(cr.libre, v_falta);
      v_usos := v_usos || jsonb_build_array(jsonb_build_object('c', cr.id, 'amt', v_tomar));
      v_falta := v_falta - v_tomar;
      exit when v_falta = 0;
    end loop;
    if v_falta > 0 then
      select coalesce(sum(greatest(s.importe - privado.saldo_usado(s.id), 0)), 0) into v_disp
        from public.saldos as s where s.cliente_id = v_cli;
      perform privado.error(format('El saldo a favor disponible es de %s.', privado.dinero(v_disp)));
    end if;
  end if;

  insert into public.pagos (fecha, medio, importe, nota, creado_por)
  values (v_fecha, v_medio, v_total, privado.limpio(p ->> 'note', 300), u)
  returning id into v_pago;

  insert into public.pago_partes (pago_id, reserva_id, importe, orden)
  select v_pago, privado.id(e.x ->> 'r'), (e.x ->> 'amt')::bigint, (e.o - 1)::int
    from jsonb_array_elements(v_reparto) with ordinality as e(x, o);

  if jsonb_array_length(v_usos) > 0 then
    insert into public.pago_saldos (pago_id, saldo_id, importe)
    select v_pago, privado.id(x ->> 'c'), (x ->> 'amt')::bigint from jsonb_array_elements(v_usos) as x;
  end if;
  return v_pago;
end $$;

-- ---------------------------------------------------------------------
-- 4. Funciones que usa la app
-- ---------------------------------------------------------------------

-- Todos los datos para la app.
create or replace function public.app_datos(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u text;
begin
  u := privado.exigir_usuario();
  return jsonb_build_object(
    'v', 1,
    'user', u,
    'version', (select c.version from public.config as c where c.id = 1),
    'methods', (select to_jsonb(c.medios) from public.config as c where c.id = 1),
    'lastBackup', (select case when c.ultima_copia is null then null
                               else jsonb_build_object('at', privado.ts(c.ultima_copia), 'by', c.ultima_copia_por) end
                     from public.config as c where c.id = 1),
    'points', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.nombre, 'address', l.direccion, 'reference', l.referencia)
                       order by l.orden)
        from public.lugares as l), '[]'::jsonb),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'firstName', c.nombre, 'lastName', c.apellido,
               'birthDate', coalesce(to_char(c.nacimiento, 'YYYY-MM-DD'), ''),
               'docType', c.doc_tipo, 'docNumber', c.doc_numero, 'docCountry', c.doc_pais,
               'phone', c.telefono, 'emergencyName', c.emergencia_nombre, 'emergencyPhone', c.emergencia_tel,
               'notes', c.notas, 'createdAt', privado.ts(c.creado_en), 'createdBy', c.creado_por,
               'updatedAt', privado.ts(c.actualizado_en), 'updatedBy', c.actualizado_por)
             order by c.creado_en)
        from public.clientes as c), '[]'::jsonb),
    'trips', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'name', t.nombre, 'origin', t.origen, 'province', t.provincia, 'city', t.ciudad,
               'departDate', to_char(t.salida_fecha, 'YYYY-MM-DD'), 'departTime', t.salida_hora,
               'returnDate', coalesce(to_char(t.regreso_fecha, 'YYYY-MM-DD'), ''), 'returnTime', t.regreso_hora,
               'hotel', t.hotel, 'meals', t.comidas, 'includes', t.incluye, 'notes', t.notas, 'art', t.dibujo,
               'price', t.precio, 'photo', t.foto, 'vehicle', jsonb_build_object('type', t.vehiculo),
               'layoutConfirmed', t.plano_confirmado, 'seats', t.butacas, 'blocks', t.bloqueos, 'pickups', t.subidas,
               'createdAt', privado.ts(t.creado_en), 'createdBy', t.creado_por)
             order by t.salida_fecha, t.creado_en)
        from public.viajes as t), '[]'::jsonb),
    'reservations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'tripId', r.viaje_id, 'clientId', r.cliente_id, 'seatId', r.butaca_id,
               'infantOf', r.en_brazos_de, 'pickupId', r.subida_id, 'price', r.precio,
               'priceLog', r.precio_log, 'seatLog', r.butaca_log, 'status', r.estado, 'groupId', r.grupo_id,
               'cancel', r.baja, 'createdAt', privado.ts(r.creado_en), 'createdBy', r.creado_por)
             order by r.creado_en)
        from public.reservas as r), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'tripId', g.viaje_id, 'name', g.nombre))
        from public.grupos as g), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pg.id, 'date', to_char(pg.fecha, 'YYYY-MM-DD'), 'method', pg.medio, 'amount', pg.importe,
               'note', pg.nota,
               'alloc', coalesce((
                  select jsonb_agg(jsonb_build_object('r', pp.reserva_id, 'amt', pp.importe) order by pp.orden)
                    from public.pago_partes as pp where pp.pago_id = pg.id), '[]'::jsonb),
               'creditUses', (
                  select jsonb_agg(jsonb_build_object('c', ps.saldo_id, 'amt', ps.importe))
                    from public.pago_saldos as ps where ps.pago_id = pg.id),
               'status', pg.estado, 'createdAt', privado.ts(pg.creado_en), 'by', pg.creado_por,
               'voidReason', pg.anulado_motivo, 'voidedAt', privado.ts(pg.anulado_en), 'voidedBy', pg.anulado_por)
             order by pg.fecha, pg.creado_en)
        from public.pagos as pg), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'resId', d.reserva_id, 'clientId', d.cliente_id, 'amount', d.importe,
               'date', to_char(d.fecha, 'YYYY-MM-DD'), 'method', d.medio, 'note', d.nota,
               'at', privado.ts(d.creado_en), 'by', d.creado_por)
             order by d.creado_en)
        from public.devoluciones as d), '[]'::jsonb),
    'credits', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'clientId', s.cliente_id, 'amount', s.importe, 'originRes', s.reserva_origen,
               'at', privado.ts(s.creado_en), 'by', s.creado_por)
             order by s.creado_en)
        from public.saldos as s), '[]'::jsonb),
    'models', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.nombre, 'type', m.tipo, 'seats', m.butacas,
                                          'at', privado.ts(m.creado_en))
             order by m.creado_en)
        from public.planos as m), '[]'::jsonb)
  );
end $$;

-- Número que cambia con cada modificación (para saber si hay novedades).
create or replace function public.app_version(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform privado.exigir_usuario();
  return (select jsonb_build_object('version', c.version) from public.config as c where c.id = 1);
end $$;

create or replace function public.guardar_cliente(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u           text := privado.inicio_escritura();
  v_id        uuid := privado.id(p ->> 'id');
  v_nombre    text := privado.limpio(p ->> 'firstName', 80);
  v_apellido  text := privado.limpio(p ->> 'lastName', 80);
  v_nac       date;
  v_tipo      text := case when p ->> 'docType' = 'Pasaporte' then 'Pasaporte' else 'DNI' end;
  v_num       text := privado.limpio(p ->> 'docNumber', 30);
  v_pais      text := '';
  v_clave     text;
  o           public.clientes%rowtype;
begin
  if v_nombre = '' or v_apellido = '' then perform privado.error('Escribí nombre y apellido.'); end if;
  v_nac := privado.fecha(p ->> 'birthDate', 'Revisá la fecha de nacimiento.');
  if v_nac is not null and v_nac > privado.hoy() then
    perform privado.error('La fecha de nacimiento no puede ser futura.');
  end if;
  if v_tipo = 'DNI' and v_num <> '' then
    v_num := regexp_replace(v_num, '\D', '', 'g');
    if length(v_num) < 6 or length(v_num) > 9 then
      perform privado.error('El DNI tiene que tener entre 6 y 9 números.');
    end if;
  end if;
  if v_tipo = 'Pasaporte' then
    v_num := upper(regexp_replace(v_num, '\s', '', 'g'));
    v_pais := privado.limpio(p ->> 'docCountry', 60);
    if v_num <> '' and v_pais = '' then perform privado.error('Indicá el país que emitió el pasaporte.'); end if;
  end if;
  v_clave := privado.clave_doc(v_tipo, v_num, v_pais);
  if v_clave is not null then
    select * into o from public.clientes where doc_clave = v_clave and (v_id is null or id <> v_id) limit 1;
    if o.id is not null then
      perform privado.error(format('Ya existe %s %s con ese documento.', o.nombre, o.apellido), 'nv_dup_cliente', o.id::text);
    end if;
  end if;
  if v_id is null then
    insert into public.clientes (nombre, apellido, nacimiento, doc_tipo, doc_numero, doc_pais, telefono,
                                 emergencia_nombre, emergencia_tel, notas, creado_por)
    values (v_nombre, v_apellido, v_nac, v_tipo, v_num, v_pais, privado.limpio(p ->> 'phone', 40),
            privado.limpio(p ->> 'emergencyName', 80), privado.limpio(p ->> 'emergencyPhone', 40),
            privado.limpio(p ->> 'notes', 1000), u)
    returning id into v_id;
  else
    update public.clientes
       set nombre = v_nombre, apellido = v_apellido, nacimiento = v_nac, doc_tipo = v_tipo,
           doc_numero = v_num, doc_pais = v_pais, telefono = privado.limpio(p ->> 'phone', 40),
           emergencia_nombre = privado.limpio(p ->> 'emergencyName', 80),
           emergencia_tel = privado.limpio(p ->> 'emergencyPhone', 40),
           notas = privado.limpio(p ->> 'notes', 1000), actualizado_en = now(), actualizado_por = u
     where id = v_id;
    if not found then perform privado.error('No se encontró el cliente.'); end if;
  end if;
  perform privado.fin_escritura();
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.guardar_lugar(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u         text := privado.inicio_escritura();
  v_id      uuid := privado.id(p ->> 'id');
  v_nombre  text := privado.limpio(p ->> 'name', 80);
begin
  if v_nombre = '' then perform privado.error('Escribí el nombre del lugar de subida.'); end if;
  if exists (select 1 from public.lugares
              where privado.normalizar(nombre) = privado.normalizar(v_nombre)
                and (v_id is null or id <> v_id)) then
    perform privado.error('Ya hay un lugar de subida con ese nombre.');
  end if;
  if v_id is null then
    insert into public.lugares (nombre, direccion, referencia)
    values (v_nombre, privado.limpio(p ->> 'address', 160), privado.limpio(p ->> 'reference', 160))
    returning id into v_id;
  else
    update public.lugares
       set nombre = v_nombre, direccion = privado.limpio(p ->> 'address', 160),
           referencia = privado.limpio(p ->> 'reference', 160)
     where id = v_id;
    if not found then perform privado.error('No se encontró el lugar.'); end if;
  end if;
  perform privado.fin_escritura();
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.borrar_lugar(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u     text := privado.inicio_escritura();
  v_id  uuid := privado.id(p ->> 'id');
  n     int;
begin
  if v_id is null then perform privado.error('No se encontró el lugar.'); end if;
  select count(*) into n from public.viajes
   where subidas @> jsonb_build_array(jsonb_build_object('pointId', v_id::text));
  if n > 0 then
    perform privado.error(format('Ese lugar está en %s. Quitalo de esos viajes antes de borrarlo.',
      privado.plural(n, 'viaje', 'viajes')));
  end if;
  delete from public.lugares where id = v_id;
  perform privado.fin_escritura();
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.guardar_viaje(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u          text := privado.inicio_escritura();
  v_id       uuid := privado.id(p ->> 'id');
  v          public.viajes%rowtype;
  v_nombre   text := privado.limpio(p ->> 'name', 120);
  v_salida   date;
  v_regreso  date;
  v_precio   bigint;
  v_tipo     text := p ->> 'type';
  v_dibujo   text := coalesce(nullif(p ->> 'art', ''), 'sierras');
  v_butacas  jsonb;
  v_subidas  jsonb;
  v_bloq     jsonb;
  v_sub      jsonb;
  v_falt     text[];
  v_n        int;
  v_upd      int := 0;
  v_skip     int := 0;
  x          record;
begin
  if v_nombre = '' then perform privado.error('Escribí el nombre del viaje.'); end if;
  v_salida := privado.fecha(p ->> 'departDate', 'Revisá la fecha de salida.');
  if v_salida is null then perform privado.error('Indicá la fecha de salida.'); end if;
  v_regreso := privado.fecha(p ->> 'returnDate', 'Revisá la fecha de regreso.');
  if v_regreso is not null and v_regreso < v_salida then
    perform privado.error('La fecha de regreso no puede ser anterior a la salida.');
  end if;
  v_precio := privado.importe(p -> 'price', 'Escribí el precio por persona, solo con números.');
  if v_tipo is null or v_tipo not in ('combi', 'micro1', 'micro2') then perform privado.error('Elegí micro o combi.'); end if;
  if v_dibujo not in ('sierras', 'lago', 'campo', 'mar', 'ciudad') then v_dibujo := 'sierras'; end if;
  if jsonb_typeof(p -> 'seats') = 'array' then v_butacas := privado.validar_butacas(p -> 'seats'); end if;

  -- Lugares de subida: solo los que existen, sin repetir, en el orden elegido.
  select coalesce(jsonb_agg(jsonb_build_object('pointId', l.id, 'time', privado.hora(z.x ->> 'time')) order by z.ord), '[]'::jsonb)
    into v_subidas
    from (
      select distinct on (privado.id(e.x ->> 'pointId')) e.x, e.ord
        from jsonb_array_elements(case when jsonb_typeof(p -> 'pickups') = 'array' then p -> 'pickups' else '[]'::jsonb end)
             with ordinality as e(x, ord)
       where privado.id(e.x ->> 'pointId') is not null
       order by privado.id(e.x ->> 'pointId'), e.ord
    ) as z
    join public.lugares as l on l.id = privado.id(z.x ->> 'pointId');
  if jsonb_array_length(v_subidas) = 0 then perform privado.error('Elegí al menos un lugar de subida.'); end if;

  if v_id is null then
    if v_butacas is null then perform privado.error('Falta el plano de butacas.'); end if;
    insert into public.viajes (nombre, origen, provincia, ciudad, salida_fecha, salida_hora, regreso_fecha, regreso_hora,
                               hotel, comidas, incluye, notas, dibujo, foto, precio, vehiculo, plano_confirmado,
                               butacas, subidas, creado_por)
    values (v_nombre, coalesce(nullif(privado.limpio(p ->> 'origin', 80), ''), 'Rosario'),
            privado.limpio(p ->> 'province', 60), privado.limpio(p ->> 'city', 80),
            v_salida, privado.hora(p ->> 'departTime'), v_regreso, privado.hora(p ->> 'returnTime'),
            privado.limpio(p ->> 'hotel', 120), privado.limpio(p ->> 'meals', 200),
            privado.limpio(p ->> 'includes', 1000), privado.limpio(p ->> 'notes', 1000),
            v_dibujo, nullif(privado.limpio(p ->> 'photo', 300), ''), v_precio, v_tipo,
            privado.si(p -> 'layoutConfirmed'), v_butacas, v_subidas, u)
    returning id into v_id;
    perform privado.fin_escritura();
    return jsonb_build_object('id', v_id, 'updated', 0, 'skipped', 0);
  end if;

  select * into v from public.viajes where id = v_id for update;
  if v.id is null then perform privado.error('No se encontró el viaje.'); end if;

  -- No se puede quitar un lugar de subida que alguien usa.
  for v_sub in select y from jsonb_array_elements(v.subidas) as y loop
    if not exists (select 1 from jsonb_array_elements(v_subidas) as w where w ->> 'pointId' = v_sub ->> 'pointId') then
      select count(*) into v_n from public.reservas
       where viaje_id = v.id and estado = 'activa' and subida_id = privado.id(v_sub ->> 'pointId');
      if v_n > 0 then
        perform privado.error(format('%s en %s. Cambiales el lugar de subida antes de quitarlo del viaje.',
          case when v_n = 1 then '1 pasajero sube' else v_n || ' pasajeros suben' end,
          coalesce((select l.nombre from public.lugares as l where l.id = privado.id(v_sub ->> 'pointId')), 'Lugar borrado')));
      end if;
    end if;
  end loop;

  -- Plano nuevo: cada pasajero y cada bloqueo conserva su número de butaca.
  v_bloq := v.bloqueos;
  if v_butacas is not null then
    v_falt := array(
      select q.num from (
        select distinct privado.butaca(v, r.butaca_id) ->> 'num' as num
          from public.reservas as r
         where r.viaje_id = v.id and r.estado = 'activa' and r.butaca_id is not null
        union
        select privado.butaca(v, b ->> 'seatId') ->> 'num' from jsonb_array_elements(v.bloqueos) as b
      ) as q
      where q.num is not null
        and not exists (select 1 from jsonb_array_elements(v_butacas) as s where s ->> 'num' = q.num)
      order by case when q.num ~ '^\d+$' then q.num::int else 100000 end, q.num
    );
    if cardinality(v_falt) > 0 then
      perform privado.error(format('Con el nuevo plano desaparecen las butacas %s, que están ocupadas o bloqueadas. Primero mové o liberá esas butacas.',
        array_to_string(v_falt, ', ')));
    end if;
    -- En dos pasos, para que dos pasajeros puedan intercambiar lugares sin chocar.
    update public.reservas
       set butaca_id = '~' || (privado.butaca(v, butaca_id) ->> 'num')
     where viaje_id = v.id and estado = 'activa' and butaca_id is not null;
    update public.reservas as r
       set butaca_id = (select s ->> 'id' from jsonb_array_elements(v_butacas) as s where '~' || (s ->> 'num') = r.butaca_id limit 1)
     where r.viaje_id = v.id and r.estado = 'activa' and r.butaca_id like '~%';
    select coalesce(jsonb_agg(b || jsonb_build_object('seatId',
             (select s ->> 'id' from jsonb_array_elements(v_butacas) as s
               where s ->> 'num' = privado.butaca(v, b ->> 'seatId') ->> 'num' limit 1))), '[]'::jsonb)
      into v_bloq
      from jsonb_array_elements(v.bloqueos) as b;
  end if;

  -- Precio nuevo: solo si se pidió, y solo para quienes tenían el precio anterior.
  if privado.si(p -> 'applyPrice') and v_precio <> v.precio then
    for x in select r.id, r.precio from public.reservas as r
              where r.viaje_id = v.id and r.estado = 'activa' and r.precio = v.precio for update loop
      if privado.pagado(x.id) > v_precio then
        v_skip := v_skip + 1;
      else
        update public.reservas
           set precio = v_precio,
               precio_log = precio_log || jsonb_build_array(jsonb_build_object(
                 'at', privado.ahora(), 'from', x.precio, 'to', v_precio, 'reason', 'Cambio de precio del viaje', 'by', u))
         where id = x.id;
        v_upd := v_upd + 1;
      end if;
    end loop;
  end if;

  update public.viajes
     set nombre = v_nombre,
         origen = coalesce(nullif(privado.limpio(p ->> 'origin', 80), ''), 'Rosario'),
         provincia = privado.limpio(p ->> 'province', 60),
         ciudad = privado.limpio(p ->> 'city', 80),
         salida_fecha = v_salida, salida_hora = privado.hora(p ->> 'departTime'),
         regreso_fecha = v_regreso, regreso_hora = privado.hora(p ->> 'returnTime'),
         hotel = privado.limpio(p ->> 'hotel', 120), comidas = privado.limpio(p ->> 'meals', 200),
         incluye = privado.limpio(p ->> 'includes', 1000), notas = privado.limpio(p ->> 'notes', 1000),
         dibujo = v_dibujo, precio = v_precio, vehiculo = v_tipo,
         butacas = coalesce(v_butacas, butacas),
         plano_confirmado = case when v_butacas is not null then privado.si(p -> 'layoutConfirmed') else plano_confirmado end,
         bloqueos = v_bloq,
         subidas = v_subidas,
         foto = case when p ? 'photo' then nullif(privado.limpio(p ->> 'photo', 300), '') else foto end,
         actualizado_en = now(), actualizado_por = u
   where id = v.id;
  perform privado.fin_escritura();
  return jsonb_build_object('id', v.id, 'updated', v_upd, 'skipped', v_skip);
end $$;

create or replace function public.crear_reserva(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u          text := privado.inicio_escritura();
  v_prev     jsonb;
  v          public.viajes%rowtype;
  c          public.clientes%rowtype;
  a          public.reservas%rowtype;
  v_sub      uuid;
  v_seat     text;
  v_inf      uuid;
  v_precio   bigint;
  v_motivo   text := privado.limpio(p ->> 'priceReason', 120);
  v_dep      jsonb := case when jsonb_typeof(p -> 'deposit') = 'object' then p -> 'deposit' else null end;
  v_dep_imp  bigint;
  v_res      uuid;
  v_out      jsonb;
begin
  v_prev := privado.token_previo(p ->> 'token');
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;

  select * into v from public.viajes where id = privado.id(p ->> 'tripId') for update;
  if v.id is null then perform privado.error('Elegí el viaje.'); end if;
  select * into c from public.clientes where id = privado.id(p ->> 'clientId');
  if c.id is null then perform privado.error('Elegí el cliente.'); end if;
  if exists (select 1 from public.reservas where viaje_id = v.id and cliente_id = c.id and estado = 'activa') then
    perform privado.error(format('%s %s ya tiene una reserva activa en este viaje.', c.nombre, c.apellido));
  end if;
  v_sub := privado.id(p ->> 'pickupId');
  if v_sub is null or not exists (select 1 from jsonb_array_elements(v.subidas) as x where x ->> 'pointId' = v_sub::text) then
    perform privado.error('Elegí el lugar de subida.');
  end if;
  if privado.id(p ->> 'infantOf') is not null then
    select * into a from public.reservas where id = privado.id(p ->> 'infantOf');
    if a.id is null or a.estado <> 'activa' or a.viaje_id <> v.id or a.butaca_id is null then
      perform privado.error('Elegí con qué adulto viaja el bebé.');
    end if;
    v_inf := a.id;
  else
    v_seat := nullif(btrim(coalesce(p ->> 'seatId', '')), '');
    if v_seat is null then perform privado.error('Elegí una butaca en el plano.'); end if;
    perform privado.verificar_butaca_libre(v, v_seat, null);
  end if;
  v_precio := privado.importe(p -> 'price', 'Revisá el precio acordado: solo números.');
  if v_precio <> v.precio and v_motivo = '' then
    perform privado.error('El precio es distinto al del viaje: indicá el motivo.');
  end if;
  if v_dep is not null then
    v_dep_imp := privado.importe(v_dep -> 'amount', 'Escribí el importe del pago.', 1);
    if v_dep_imp > v_precio then perform privado.error('El pago no puede superar el precio acordado.'); end if;
  end if;

  insert into public.reservas (viaje_id, cliente_id, butaca_id, en_brazos_de, subida_id, precio, precio_log, creado_por)
  values (v.id, c.id, v_seat, v_inf, v_sub, v_precio,
          jsonb_build_array(jsonb_build_object('at', privado.ahora(), 'from', null, 'to', v_precio,
                            'reason', coalesce(nullif(v_motivo, ''), 'Precio del viaje'), 'by', u)),
          u)
  returning id into v_res;

  if privado.id(p ->> 'groupWith') is not null then
    perform privado.unir_grupo(v_res, privado.id(p ->> 'groupWith'));
  elsif v_inf is not null then
    perform privado.unir_grupo(v_res, v_inf);
  end if;

  if v_dep is not null then
    perform privado.pago_interno(u, jsonb_build_object(
      'date', coalesce(nullif(v_dep ->> 'date', ''), to_char(privado.hoy(), 'YYYY-MM-DD')),
      'method', v_dep ->> 'method', 'amount', v_dep_imp, 'note', v_dep ->> 'note',
      'alloc', jsonb_build_array(jsonb_build_object('r', v_res, 'amt', v_dep_imp)),
      'creditClientId', c.id));
  end if;

  v_out := jsonb_build_object('id', v_res);
  perform privado.guardar_token(p ->> 'token', v_out);
  perform privado.fin_escritura();
  return v_out;
end $$;

create or replace function public.registrar_pago(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u       text := privado.inicio_escritura();
  v_prev  jsonb;
  v_out   jsonb;
begin
  v_prev := privado.token_previo(p ->> 'token');
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  v_out := jsonb_build_object('id', privado.pago_interno(u, p));
  perform privado.guardar_token(p ->> 'token', v_out);
  perform privado.fin_escritura();
  return v_out;
end $$;

create or replace function public.anular_pago(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u         text := privado.inicio_escritura();
  v_pago    public.pagos%rowtype;
  v_motivo  text := privado.limpio(p ->> 'reason', 200);
begin
  select * into v_pago from public.pagos where id = privado.id(p ->> 'id') for update;
  if v_pago.id is null or v_pago.estado <> 'valido' then perform privado.error('Ese pago ya estaba anulado.'); end if;
  if v_motivo = '' then perform privado.error('Escribí el motivo de la anulación.'); end if;
  if exists (select 1 from public.pago_partes as pp join public.reservas as r on r.id = pp.reserva_id
              where pp.pago_id = v_pago.id and r.estado <> 'activa') then
    perform privado.error('No se puede anular: una de las reservas está dada de baja y su dinero ya quedó registrado en la baja.');
  end if;
  update public.pagos
     set estado = 'anulado', anulado_motivo = v_motivo, anulado_en = now(), anulado_por = u
   where id = v_pago.id;
  perform privado.fin_escritura();
  return jsonb_build_object('id', v_pago.id);
end $$;

create or replace function public.cambiar_butaca(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u      text := privado.inicio_escritura();
  r      public.reservas%rowtype;
  v      public.viajes%rowtype;
  v_sid  text := nullif(btrim(coalesce(p ->> 'seatId', '')), '');
  b      jsonb;
begin
  select * into r from public.reservas where id = privado.id(p ->> 'resId') for update;
  if r.id is null or r.estado <> 'activa' then perform privado.error('La reserva no está activa.'); end if;
  if r.butaca_id is null then perform privado.error('Esta reserva es de un bebé sin butaca.'); end if;
  if r.butaca_id = v_sid then perform privado.error('Ya está en esa butaca.'); end if;
  select * into v from public.viajes where id = r.viaje_id for update;
  b := privado.verificar_butaca_libre(v, v_sid, r.id);
  update public.reservas
     set butaca_id = v_sid,
         butaca_log = butaca_log || jsonb_build_array(jsonb_build_object(
           'at', privado.ahora(), 'from', privado.butaca(v, r.butaca_id) ->> 'num', 'to', b ->> 'num', 'by', u))
   where id = r.id;
  perform privado.fin_escritura();
  return jsonb_build_object('id', r.id);
end $$;

create or replace function public.cambiar_subida(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u      text := privado.inicio_escritura();
  r      public.reservas%rowtype;
  v      public.viajes%rowtype;
  v_sub  uuid := privado.id(p ->> 'pointId');
begin
  select * into r from public.reservas where id = privado.id(p ->> 'resId') for update;
  if r.id is null or r.estado <> 'activa' then perform privado.error('La reserva no está activa.'); end if;
  select * into v from public.viajes where id = r.viaje_id;
  if v_sub is null or not exists (select 1 from jsonb_array_elements(v.subidas) as x where x ->> 'pointId' = v_sub::text) then
    perform privado.error('Elegí un lugar de subida del viaje.');
  end if;
  update public.reservas set subida_id = v_sub where id = r.id;
  perform privado.fin_escritura();
  return jsonb_build_object('id', r.id);
end $$;

create or replace function public.cambiar_precio(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u         text := privado.inicio_escritura();
  r         public.reservas%rowtype;
  v_precio  bigint;
  v_motivo  text := privado.limpio(p ->> 'reason', 160);
  v_pagado  bigint;
begin
  select * into r from public.reservas where id = privado.id(p ->> 'resId') for update;
  if r.id is null or r.estado <> 'activa' then perform privado.error('La reserva no está activa.'); end if;
  v_precio := privado.importe(p -> 'price', 'Escribí el precio con números.');
  if v_precio = r.precio then perform privado.error('Es el mismo precio que ya tiene.'); end if;
  if v_motivo = '' then perform privado.error('Indicá el motivo del cambio de precio.'); end if;
  v_pagado := privado.pagado(r.id);
  if v_precio < v_pagado then
    perform privado.error(format('Ya pagó %s: el precio no puede ser menor a eso.', privado.dinero(v_pagado)));
  end if;
  update public.reservas
     set precio = v_precio,
         precio_log = precio_log || jsonb_build_array(jsonb_build_object(
           'at', privado.ahora(), 'from', r.precio, 'to', v_precio, 'reason', v_motivo, 'by', u))
   where id = r.id;
  perform privado.fin_escritura();
  return jsonb_build_object('id', r.id);
end $$;

create or replace function public.unir_grupo(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u  text := privado.inicio_escritura();
  r  public.reservas%rowtype;
begin
  select * into r from public.reservas where id = privado.id(p ->> 'resId') for update;
  if r.id is null or r.estado <> 'activa' then perform privado.error('La reserva no está activa.'); end if;
  if privado.id(p ->> 'otherId') is null then perform privado.error('Elegí con quién paga.'); end if;
  perform privado.unir_grupo(r.id, privado.id(p ->> 'otherId'));
  perform privado.fin_escritura();
  return jsonb_build_object('id', r.id);
end $$;

create or replace function public.salir_grupo(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u  text := privado.inicio_escritura();
  r  public.reservas%rowtype;
begin
  select * into r from public.reservas where id = privado.id(p ->> 'resId') for update;
  if r.id is null then perform privado.error('No se encontró la reserva.'); end if;
  perform privado.salir_grupo(r.id);
  perform privado.fin_escritura();
  return jsonb_build_object('id', r.id);
end $$;

create or replace function public.cambiar_adulto(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u  text := privado.inicio_escritura();
  r  public.reservas%rowtype;
  a  public.reservas%rowtype;
begin
  select * into r from public.reservas where id = privado.id(p ->> 'resId') for update;
  if r.id is null or r.estado <> 'activa' then perform privado.error('La reserva no está activa.'); end if;
  if r.butaca_id is not null then perform privado.error('Esta reserva tiene butaca propia.'); end if;
  select * into a from public.reservas where id = privado.id(p ->> 'adultId');
  if a.id is null or a.estado <> 'activa' or a.butaca_id is null or a.viaje_id <> r.viaje_id then
    perform privado.error('Elegí un adulto con butaca de este viaje.');
  end if;
  update public.reservas set en_brazos_de = a.id where id = r.id;
  perform privado.unir_grupo(r.id, a.id);
  perform privado.fin_escritura();
  return jsonb_build_object('id', r.id);
end $$;

create or replace function public.dar_de_baja(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u         text := privado.inicio_escritura();
  r         public.reservas%rowtype;
  x         public.reservas%rowtype;
  v         public.viajes%rowtype;
  v_ids     uuid[];
  v_dinero  text := coalesce(p ->> 'money', '');
  v_metodo  text := privado.limpio(p ->> 'refundMethod', 60);
  v_motivo  text := privado.limpio(p ->> 'reason', 200);
  v_fecha   date;
  v_pagado  bigint;
  v_baja    jsonb;
  v_dev     uuid;
  v_sal     uuid;
  n         int := 0;
begin
  select * into r from public.reservas where id = privado.id(p ->> 'resId') for update;
  if r.id is null or r.estado <> 'activa' then perform privado.error('La reserva ya no está activa.'); end if;
  v_ids := array[r.id];
  if privado.si(p -> 'withInfants') then
    v_ids := v_ids || array(select b.id from public.reservas as b
                             where b.en_brazos_de = r.id and b.estado = 'activa' order by b.creado_en);
  end if;
  v_fecha := coalesce(privado.fecha(p ->> 'refundDate', 'Revisá la fecha de la devolución.'), privado.hoy());

  -- Primero se valida todo; después se cambia.
  for x in select * from public.reservas where id = any(v_ids) for update loop
    v_pagado := privado.pagado(x.id);
    if v_pagado > 0 and v_dinero not in ('devuelto', 'saldo', 'pendiente') then
      perform privado.error('Indicá qué pasó con el dinero que ya pagó.');
    end if;
    if v_pagado > 0 and v_dinero = 'devuelto' and v_metodo = '' then
      perform privado.error('Indicá cómo se devolvió el dinero.');
    end if;
    if v_pagado > 0 and v_dinero = 'devuelto' and v_fecha > privado.hoy() then
      perform privado.error('La fecha de la devolución no puede ser futura.');
    end if;
  end loop;

  select * into v from public.viajes where id = r.viaje_id;
  for x in select * from public.reservas where id = any(v_ids) order by array_position(v_ids, id) loop
    v_pagado := privado.pagado(x.id);
    v_dev := null;
    v_sal := null;
    if v_pagado > 0 and v_dinero = 'devuelto' then
      insert into public.devoluciones (reserva_id, cliente_id, importe, fecha, medio, nota, creado_por)
      values (x.id, x.cliente_id, v_pagado, v_fecha, v_metodo, privado.limpio(p ->> 'refundNote', 300), u)
      returning id into v_dev;
    elsif v_pagado > 0 and v_dinero = 'saldo' then
      insert into public.saldos (cliente_id, importe, reserva_origen, creado_por)
      values (x.cliente_id, v_pagado, x.id, u)
      returning id into v_sal;
    end if;
    v_baja := jsonb_build_object(
      'at', privado.ahora(), 'by', u, 'reason', v_motivo,
      'seatNum', case when x.butaca_id is null then null else privado.etiqueta(privado.butaca(v, x.butaca_id)) end,
      'paid', v_pagado,
      'money', case when v_pagado > 0 then v_dinero else null end,
      'refundId', v_dev, 'creditId', v_sal);
    perform privado.salir_grupo(x.id);
    update public.reservas set estado = 'cancelada', baja = v_baja, butaca_id = null where id = x.id;
    n := n + 1;
  end loop;
  perform privado.fin_escritura();
  return jsonb_build_object('count', n);
end $$;

create or replace function public.resolver_baja(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u         text := privado.inicio_escritura();
  r         public.reservas%rowtype;
  v_dinero  text := coalesce(p ->> 'money', '');
  v_metodo  text := privado.limpio(p ->> 'refundMethod', 60);
  v_fecha   date;
  v_pagado  bigint;
  v_baja    jsonb;
  v_id      uuid;
begin
  select * into r from public.reservas where id = privado.id(p ->> 'resId') for update;
  if r.id is null or r.estado <> 'cancelada' or r.baja is null or (r.baja ->> 'money') is distinct from 'pendiente' then
    perform privado.error('No hay dinero pendiente en esta baja.');
  end if;
  v_pagado := (r.baja ->> 'paid')::bigint;
  v_baja := r.baja;
  if v_dinero = 'devuelto' then
    if v_metodo = '' then perform privado.error('Indicá cómo se devolvió el dinero.'); end if;
    v_fecha := coalesce(privado.fecha(p ->> 'refundDate', 'Revisá la fecha de la devolución.'), privado.hoy());
    if v_fecha > privado.hoy() then perform privado.error('La fecha de la devolución no puede ser futura.'); end if;
    insert into public.devoluciones (reserva_id, cliente_id, importe, fecha, medio, nota, creado_por)
    values (r.id, r.cliente_id, v_pagado, v_fecha, v_metodo, privado.limpio(p ->> 'refundNote', 300), u)
    returning id into v_id;
    v_baja := v_baja || jsonb_build_object('refundId', v_id);
  elsif v_dinero = 'saldo' then
    insert into public.saldos (cliente_id, importe, reserva_origen, creado_por)
    values (r.cliente_id, v_pagado, r.id, u)
    returning id into v_id;
    v_baja := v_baja || jsonb_build_object('creditId', v_id);
  else
    perform privado.error('Elegí qué pasó con el dinero.');
  end if;
  v_baja := v_baja || jsonb_build_object('money', v_dinero, 'resolvedAt', privado.ahora(), 'resolvedBy', u);
  update public.reservas set baja = v_baja where id = r.id;
  perform privado.fin_escritura();
  return jsonb_build_object('id', r.id);
end $$;

create or replace function public.bloquear_butaca(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u      text := privado.inicio_escritura();
  v      public.viajes%rowtype;
  v_sid  text := p ->> 'seatId';
begin
  select * into v from public.viajes where id = privado.id(p ->> 'tripId') for update;
  if v.id is null then perform privado.error('No se encontró el viaje.'); end if;
  if privado.butaca(v, v_sid) is null then perform privado.error('No se encontró la butaca.'); end if;
  if exists (select 1 from public.reservas where viaje_id = v.id and estado = 'activa' and butaca_id = v_sid) then
    perform privado.error('La butaca está ocupada.');
  end if;
  if exists (select 1 from jsonb_array_elements(v.bloqueos) as x where x ->> 'seatId' = v_sid) then
    perform privado.error('La butaca ya está bloqueada.');
  end if;
  update public.viajes
     set bloqueos = bloqueos || jsonb_build_array(jsonb_build_object(
           'seatId', v_sid,
           'reason', coalesce(nullif(privado.limpio(p ->> 'reason', 40), ''), 'Coordinación'),
           'name', privado.limpio(p ->> 'name', 60))),
         actualizado_en = now(), actualizado_por = u
   where id = v.id;
  perform privado.fin_escritura();
  return jsonb_build_object('id', v.id);
end $$;

create or replace function public.desbloquear_butaca(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u      text := privado.inicio_escritura();
  v      public.viajes%rowtype;
  v_sid  text := p ->> 'seatId';
begin
  select * into v from public.viajes where id = privado.id(p ->> 'tripId') for update;
  if v.id is null then perform privado.error('No se encontró el viaje.'); end if;
  update public.viajes
     set bloqueos = coalesce((select jsonb_agg(x) from jsonb_array_elements(v.bloqueos) as x where x ->> 'seatId' <> v_sid), '[]'::jsonb),
         actualizado_en = now(), actualizado_por = u
   where id = v.id;
  perform privado.fin_escritura();
  return jsonb_build_object('id', v.id);
end $$;

-- Ajustes del plano (números, butacas agregadas o quitadas, confirmado).
create or replace function public.guardar_plano(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u          text := privado.inicio_escritura();
  v          public.viajes%rowtype;
  v_butacas  jsonb;
  v_falt     text[];
begin
  select * into v from public.viajes where id = privado.id(p ->> 'tripId') for update;
  if v.id is null then perform privado.error('No se encontró el viaje.'); end if;
  if jsonb_typeof(p -> 'seats') = 'array' then
    v_butacas := privado.validar_butacas(p -> 'seats');
    v_falt := array(
      select distinct privado.butaca(v, q.sid) ->> 'num'
        from (select r.butaca_id as sid from public.reservas as r
               where r.viaje_id = v.id and r.estado = 'activa' and r.butaca_id is not null
              union all
              select b ->> 'seatId' from jsonb_array_elements(v.bloqueos) as b) as q
       where not exists (select 1 from jsonb_array_elements(v_butacas) as s where s ->> 'id' = q.sid));
    if cardinality(v_falt) > 0 then
      perform privado.error(format('No se puede quitar la butaca %s: está ocupada o bloqueada.', array_to_string(v_falt, ', ')));
    end if;
    update public.viajes set butacas = v_butacas, actualizado_en = now(), actualizado_por = u where id = v.id;
  end if;
  if jsonb_typeof(p -> 'confirmed') = 'boolean' then
    update public.viajes set plano_confirmado = privado.si(p -> 'confirmed'), actualizado_en = now(), actualizado_por = u
     where id = v.id;
  end if;
  perform privado.fin_escritura();
  return jsonb_build_object('id', v.id);
end $$;

create or replace function public.guardar_modelo(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u         text := privado.inicio_escritura();
  v         public.viajes%rowtype;
  v_nombre  text := privado.limpio(p ->> 'name', 80);
  v_id      uuid;
begin
  select * into v from public.viajes where id = privado.id(p ->> 'tripId');
  if v.id is null then perform privado.error('No se encontró el viaje.'); end if;
  if v_nombre = '' then perform privado.error('Escribí un nombre para el plano.'); end if;
  insert into public.planos (nombre, tipo, butacas) values (v_nombre, v.vehiculo, v.butacas) returning id into v_id;
  perform privado.fin_escritura();
  return jsonb_build_object('id', v_id, 'name', v_nombre);
end $$;

create or replace function public.borrar_modelo(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u text := privado.inicio_escritura();
begin
  delete from public.planos where id = privado.id(p ->> 'id');
  perform privado.fin_escritura();
  return jsonb_build_object('id', p ->> 'id');
end $$;

create or replace function public.guardar_medios(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  u        text := privado.inicio_escritura();
  v_lista  text[] := '{}';
  v_vistos text[] := '{}';
  m        text;
begin
  if jsonb_typeof(p -> 'methods') is distinct from 'array' then perform privado.error('La lista de medios de pago no es válida.'); end if;
  for m in select privado.limpio(x #>> '{}', 40) from jsonb_array_elements(p -> 'methods') as x loop
    continue when m = '';
    if privado.normalizar(m) = 'saldo a favor' then
      perform privado.error('Ese nombre está reservado para el saldo a favor.');
    end if;
    if privado.normalizar(m) = any(v_vistos) then perform privado.error('Ese medio de pago ya existe.'); end if;
    v_vistos := v_vistos || privado.normalizar(m);
    v_lista := v_lista || m;
  end loop;
  if cardinality(v_lista) = 0 then perform privado.error('Tiene que quedar al menos un medio de pago.'); end if;
  if cardinality(v_lista) > 15 then perform privado.error('Son demasiados medios de pago.'); end if;
  update public.config set medios = v_lista where id = 1;
  perform privado.fin_escritura();
  return jsonb_build_object('methods', to_jsonb(v_lista));
end $$;

-- Anota que alguien descargó una copia de seguridad (para recordar hacerla seguido).
create or replace function public.registrar_copia(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u text := privado.inicio_escritura();
begin
  update public.config set ultima_copia = clock_timestamp(), ultima_copia_por = u where id = 1;
  perform privado.fin_escritura();
  return jsonb_build_object('by', u);
end $$;

-- ---------------------------------------------------------------------
-- 5. Permisos: las tablas no se pueden tocar desde internet; solo se
--    pueden llamar las funciones de la app, y solo con sesión iniciada.
-- ---------------------------------------------------------------------

alter table public.usuarios     enable row level security;
alter table public.config       enable row level security;
alter table public.operaciones  enable row level security;
alter table public.lugares      enable row level security;
alter table public.clientes     enable row level security;
alter table public.viajes       enable row level security;
alter table public.grupos       enable row level security;
alter table public.reservas     enable row level security;
alter table public.pagos        enable row level security;
alter table public.pago_partes  enable row level security;
alter table public.saldos       enable row level security;
alter table public.pago_saldos  enable row level security;
alter table public.devoluciones enable row level security;
alter table public.planos       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['usuarios','config','operaciones','lugares','clientes','viajes','grupos','reservas',
                           'pagos','pago_partes','saldos','pago_saldos','devoluciones','planos'] loop
    execute format('create policy nv_lectura on public.%I for select to authenticated using ((select privado.es_usuario()))', t);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema privado from public, anon, authenticated;

grant execute on function privado.es_usuario() to authenticated;
grant execute on function
  public.app_datos(jsonb), public.app_version(jsonb),
  public.guardar_cliente(jsonb), public.guardar_lugar(jsonb), public.borrar_lugar(jsonb),
  public.guardar_viaje(jsonb), public.crear_reserva(jsonb), public.registrar_pago(jsonb), public.anular_pago(jsonb),
  public.cambiar_butaca(jsonb), public.cambiar_subida(jsonb), public.cambiar_precio(jsonb),
  public.unir_grupo(jsonb), public.salir_grupo(jsonb), public.cambiar_adulto(jsonb),
  public.dar_de_baja(jsonb), public.resolver_baja(jsonb),
  public.bloquear_butaca(jsonb), public.desbloquear_butaca(jsonb), public.guardar_plano(jsonb),
  public.guardar_modelo(jsonb), public.borrar_modelo(jsonb), public.guardar_medios(jsonb),
  public.registrar_copia(jsonb)
to authenticated;

-- ---------------------------------------------------------------------
-- 6. Fotos de los viajes (privadas: solo las ven los usuarios autorizados)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy nv_fotos_ver on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and (select privado.es_usuario()));
create policy nv_fotos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (select privado.es_usuario()));
create policy nv_fotos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (select privado.es_usuario()));

-- ---------------------------------------------------------------------
-- 7. Datos iniciales
-- ---------------------------------------------------------------------

insert into public.lugares (nombre) values
  ('Terminal de Ómnibus Rosario'),
  ('Rosario Centro'),
  ('Rosario Zona Sur'),
  ('Rosario Zona Norte'),
  ('San Lorenzo'),
  ('Gálvez');
