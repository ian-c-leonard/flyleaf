-- A submission either shares something new or suggests a correction.
ALTER TABLE submissions ADD COLUMN kind TEXT NOT NULL DEFAULT 'share' CHECK (kind IN ('share', 'correction'));
DROP TRIGGER submission_original_immutable;
CREATE TRIGGER submission_original_immutable BEFORE UPDATE OF id, user_id, email, kind, title, body, link, association, manifest_sha256, created_at ON submissions BEGIN
  SELECT RAISE(ABORT, 'FAMILY_ORIGINAL_IMMUTABLE');
END;
