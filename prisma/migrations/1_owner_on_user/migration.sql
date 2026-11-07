-- Una cuenta = un negocio: la relación pasa de "Business"."userId" a "User"."businessId".
-- La migración conserva todos los datos existentes.

-- 1) El negocio se crea en el registro con su nombre; el resto se completa en la configuración.
ALTER TABLE "Business" ALTER COLUMN "businessType" SET DEFAULT '';
ALTER TABLE "Business" ALTER COLUMN "productType" SET DEFAULT '';
ALTER TABLE "Business" ALTER COLUMN "defaultUnit" SET DEFAULT 'Unidad';

-- 2) Nueva referencia del usuario a su negocio.
ALTER TABLE "User" ADD COLUMN "businessId" TEXT;

-- 3) Copiar la relación existente (dueño actual de cada negocio).
UPDATE "User" AS u
SET "businessId" = b."id"
FROM "Business" AS b
WHERE b."userId" = u."id";

-- 4) Usuarios que aún no tenían negocio: se les crea uno pendiente de configurar.
WITH pendientes AS (
  SELECT u."id" AS uid, gen_random_uuid()::text AS bid, u."name" AS uname
  FROM "User" AS u
  WHERE u."businessId" IS NULL
), creados AS (
  INSERT INTO "Business" ("id", "name", "updatedAt")
  SELECT bid, 'Negocio de ' || uname, CURRENT_TIMESTAMP FROM pendientes
  RETURNING "id"
)
UPDATE "User" AS u
SET "businessId" = p.bid
FROM pendientes AS p
WHERE u."id" = p.uid;

-- 5) Restricciones: obligatorio, único (1 a 1) y con clave foránea.
ALTER TABLE "User" ALTER COLUMN "businessId" SET NOT NULL;
CREATE UNIQUE INDEX "User_businessId_key" ON "User"("businessId");
ALTER TABLE "User" ADD CONSTRAINT "User_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6) Quitar la columna anterior (su información ya está en "User"."businessId").
ALTER TABLE "Business" DROP CONSTRAINT "Business_userId_fkey";
DROP INDEX "Business_userId_key";
ALTER TABLE "Business" DROP COLUMN "userId";
