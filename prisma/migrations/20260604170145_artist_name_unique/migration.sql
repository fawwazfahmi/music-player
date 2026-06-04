-- AlterTable: make Artist.name unique
ALTER TABLE "Artist" DROP CONSTRAINT IF EXISTS "Artist_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Artist_name_key" ON "Artist"("name");
ALTER TABLE "Artist" ADD CONSTRAINT "Artist_name_key" UNIQUE USING INDEX "Artist_name_key";
