// Base de datos de prueba: PostgreSQL real (PGlite) con lo mínimo de Supabase
// (roles, auth.jwt(), esquema storage) para correr instalar.sql sin cambios.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SQL = fs.readFileSync(path.join(here, '..', 'supabase', 'instalar.sql'), 'utf8');

const STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
create schema storage;
grant usage on schema storage to anon, authenticated;
create table storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now());
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;
`;

export const USUARIOS = { laucha: 'laucha@prueba.ar', nieves: 'nieves@prueba.ar', extrano: 'otro@prueba.ar' };

export const FUNCIONES = new Set(['app_datos', 'app_version', 'guardar_cliente', 'guardar_lugar', 'borrar_lugar',
  'guardar_viaje', 'crear_reserva', 'registrar_pago', 'anular_pago', 'cambiar_butaca', 'cambiar_subida',
  'cambiar_precio', 'unir_grupo', 'salir_grupo', 'cambiar_adulto', 'dar_de_baja', 'resolver_baja',
  'bloquear_butaca', 'desbloquear_butaca', 'guardar_plano', 'guardar_modelo', 'borrar_modelo', 'guardar_medios',
  'registrar_copia']);

export async function crearBase() {
  const db = new PGlite();
  await db.exec(STUBS);
  await db.exec(SQL);
  await db.exec(`insert into public.usuarios (email, nombre) values
    ('${USUARIOS.laucha}', 'Laucha'), ('${USUARIOS.nieves}', 'Nieves');`);
  return db;
}

// Llama a una función como lo haría la app (rol "authenticated" con el mail en el token).
export async function rpc(db, email, fn, p = {}, rol = 'authenticated') {
  if (!FUNCIONES.has(fn)) throw new Error('Función desconocida: ' + fn);
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify(email ? { email, role: rol, sub: '00000000-0000-0000-0000-000000000001' } : { role: rol })]);
    await tx.exec(`set local role ${rol === 'anon' ? 'anon' : 'authenticated'}`);
    const r = await tx.query(`select public.${fn}($1::jsonb) as r`, [JSON.stringify(p)]);
    return r.rows[0].r;
  });
}

// Corre una consulta como un usuario con sesión (para probar las reglas de las fotos).
export async function comoUsuario(db, email, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ email, role: 'authenticated', sub: '00000000-0000-0000-0000-000000000001' })]);
    await tx.exec('set local role authenticated');
    return (await tx.query(sql, params)).rows;
  });
}

// Igual que rpc, pero devuelve {data, error} con la forma de Supabase (PostgREST).
export async function rpcSupabase(db, email, fn, p = {}) {
  try {
    return { data: await rpc(db, email, fn, p), error: null };
  } catch (e) {
    return { data: null, error: { message: e.message, code: e.code || '', details: e.detail || '', hint: e.hint || '' } };
  }
}
