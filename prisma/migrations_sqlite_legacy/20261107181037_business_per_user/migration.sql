-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Business" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "defaultUnit" TEXT NOT NULL,
    "useCategories" BOOLEAN NOT NULL DEFAULT false,
    "useProductCodes" BOOLEAN NOT NULL DEFAULT false,
    "useMinStock" BOOLEAN NOT NULL DEFAULT false,
    "minStock" DECIMAL,
    "useExpirationDates" BOOLEAN NOT NULL DEFAULT false,
    "theme" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Business_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Business" ("businessType", "createdAt", "defaultUnit", "id", "minStock", "name", "productType", "theme", "updatedAt", "useCategories", "useExpirationDates", "useMinStock", "useProductCodes") SELECT "businessType", "createdAt", "defaultUnit", "id", "minStock", "name", "productType", "theme", "updatedAt", "useCategories", "useExpirationDates", "useMinStock", "useProductCodes" FROM "Business";
DROP TABLE "Business";
ALTER TABLE "new_Business" RENAME TO "Business";
CREATE UNIQUE INDEX "Business_userId_key" ON "Business"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
