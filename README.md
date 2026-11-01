# Nieves Viajes · Gestión

App privada para administrar los viajes grupales de Nieves Travel: viajes, clientes, butacas, pagos, bajas y la lista del chofer.

Este repositorio tiene **solo el programa**. No contiene datos de pasajeros: esos viven en una base de datos privada (Supabase) y solo se ven después de iniciar sesión con un usuario autorizado.

## Cómo funciona

| Parte | Dónde está | Para qué |
|---|---|---|
| La app (esta carpeta) | GitHub Pages | Las pantallas. Se instala en el celular como una aplicación. |
| Datos | Supabase (Postgres, región São Paulo) | Clientes, viajes, reservas, pagos. Compartidos entre los dos usuarios. |
| Fotos de los viajes | Supabase Storage, carpeta privada `fotos` | Se ven con enlaces temporales. |
| Usuarios | Supabase Auth | Mail y contraseña. Solo los mails de la tabla `usuarios` ven datos. |

### Seguridad

- Las tablas no se pueden leer ni escribir desde internet. Todo pasa por funciones de la base (`supabase/instalar.sql`) que primero comprueban que el mail esté autorizado.
- Las reglas importantes las hace la base, no la pantalla: una butaca no puede tener dos pasajeros activos, un cliente no se repite en un viaje, un DNI no se repite, el saldo a favor no se usa dos veces y un pago enviado dos veces se guarda una sola vez.
- `js/config.js` tiene la dirección del proyecto y la clave *publishable*. Son públicas a propósito: sin un usuario autorizado no dan acceso a nada.
- Al salir se borra la copia local de los datos del dispositivo.

## Instalación (una sola vez)

1. Crear el proyecto en Supabase y ejecutar `supabase/instalar.sql`.
2. Cargar los mails autorizados: `insert into public.usuarios (email, nombre) values ('mail@ejemplo.com', 'Nombre');`
3. En Authentication › Users, crear cada usuario con su contraseña («Auto Confirm User» marcado).
4. En Authentication › Sign In / Providers, desactivar «Allow new users to sign up».
5. Completar `js/config.js` con la URL del proyecto y la clave publishable.
6. En GitHub: Settings › Pages › Deploy from a branch › `main` / `(root)`.

## Cambios

- Cada cambio que se sube a `main` se publica solo en GitHub Pages en un par de minutos.
- Si se cambia algún archivo de la app, subir el número de versión en `index.html`, `sw.js` y los `?v=` para que los celulares tomen la versión nueva.
- Los cambios en la base se hacen con un archivo SQL nuevo (no editar datos a mano).

## Pruebas

```bash
cd pruebas
npm install
node sql.test.mjs           # base de datos: permisos, reglas y los 5 casos reales
node app.test.mjs           # la app completa en Chromium (dos dispositivos, fotos, copias, sin conexión, celular)
node cliente-real.test.mjs  # la app con el cliente real de Supabase
```

Las pruebas usan una base Postgres local (PGlite) con datos ficticios. No tocan la base real.
