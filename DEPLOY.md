# Despliegue del backend de PollyStock

Base de datos: **PostgreSQL** (Neon). Servidor: **Render** (`render.yaml`).

## Variables de entorno (solo en el servidor)

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Connection string de Postgres (Neon), con `sslmode=require`. |
| `AUTH_SECRET` | Firma de los JWT. Mínimo 32 caracteres aleatorios. Render la genera (`generateValue`). |
| `GEMINI_API_KEY` | Clave de Google Gemini. |
| `GEMINI_MODEL` | Modelo de Gemini (por defecto `gemini-3.8-flash`). |

Ninguna de estas variables va en la app móvil ni en el repositorio (`.env` está en `.gitignore`).
Cambiar `AUTH_SECRET` cierra todas las sesiones abiertas.

## Primer despliegue

1. Crear el proyecto en Neon y copiar la connection string.
2. En Render: **New → Blueprint** → repositorio `pollystock-backend`; completar `DATABASE_URL`,
   `GEMINI_API_KEY` y `GEMINI_MODEL`.
3. Render ejecuta `npm run build` (genera Prisma y compila) y `npm start`, que aplica las
   migraciones pendientes (`prisma migrate deploy`) antes de arrancar.

## Importar los datos anteriores (SQLite → Postgres), una sola vez

Con `DATABASE_URL` apuntando a la base de Neon y las migraciones ya aplicadas:

```bash
npm run db:import-sqlite
```

- Copia usuarios, negocios, características, productos y movimientos conservando ids,
  relaciones y contraseñas.
- Es idempotente: si se ejecuta de nuevo, no duplica (omite los ids que ya existen).

## Asignar dueño a un negocio sin cuenta

Si un negocio importado no tenía usuario (el script lo avisa), se le crea su cuenta sin tocar
su inventario:

```bash
OWNER_PASSWORD='<contraseña de 8+ caracteres>' node scripts/assign-owner.js <businessId> <correo> "<nombre>"
```

Se niega si el negocio ya tiene dueño o si el correo ya existe. Si el negocio era solo de
prueba, puede dejarse sin dueño: no es accesible desde la API.

## Pruebas

Contra una base de **prueba** (su nombre debe contener `test`; las pruebas se niegan a correr en otra):

```bash
DATABASE_URL=postgresql://…/pollystock_test AUTH_SECRET=<32+ caracteres> npm run test:auth
```
