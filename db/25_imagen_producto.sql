BEGIN;
ALTER TABLE productos ADD COLUMN imagen TEXT CHECK (octet_length(imagen)<=1400000);
COMMIT;
