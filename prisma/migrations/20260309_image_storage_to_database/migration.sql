-- Move image storage from filesystem to database for environment isolation.
-- See schema.prisma comment block on unit_images for future migration path to object storage.

-- Add new columns
ALTER TABLE "unit_images" ADD COLUMN "image_data" BYTEA;
ALTER TABLE "unit_images" ADD COLUMN "content_type" TEXT NOT NULL DEFAULT 'image/jpeg';
ALTER TABLE "unit_images" ADD COLUMN "filename" TEXT;

-- Migrate: set filename from image_path for existing rows
UPDATE "unit_images" SET "filename" = "image_path" WHERE "filename" IS NULL;

-- Make filename NOT NULL after backfill
ALTER TABLE "unit_images" ALTER COLUMN "filename" SET NOT NULL;

-- Load existing images from disk into database.
-- Uses pg_read_binary_file which requires the uploads directory path.
-- Each environment has its own path, so we try all known paths.
DO $$
DECLARE
  r RECORD;
  img_bytes BYTEA;
  upload_dirs TEXT[] := ARRAY[
    '/opt/retailarb/public/uploads/',
    '/opt/retailarb-staging/public/uploads/',
    '/opt/retailarb-dev/public/uploads/'
  ];
  dir TEXT;
  loaded BOOLEAN;
BEGIN
  FOR r IN SELECT id, filename FROM unit_images WHERE image_data IS NULL LOOP
    loaded := FALSE;
    FOREACH dir IN ARRAY upload_dirs LOOP
      BEGIN
        img_bytes := pg_read_binary_file(dir || r.filename);
        UPDATE unit_images SET image_data = img_bytes WHERE id = r.id;
        RAISE NOTICE 'Loaded % from %', r.filename, dir;
        loaded := TRUE;
        EXIT; -- stop trying other dirs
      EXCEPTION WHEN OTHERS THEN
        CONTINUE; -- try next dir
      END;
    END LOOP;
    IF NOT loaded THEN
      RAISE WARNING 'Could not load %: file not found in any upload directory', r.filename;
    END IF;
  END LOOP;
END $$;

-- Drop old column
ALTER TABLE "unit_images" DROP COLUMN "image_path";
