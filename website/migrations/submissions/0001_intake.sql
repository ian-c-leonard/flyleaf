-- Immutable contributions; review changes are separate from original wording.
-- Capacity stays reserved through interrupted uploads. No automatic deletion.
CREATE TABLE submission_capacity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  submission_count INTEGER NOT NULL DEFAULT 0
);
INSERT INTO submission_capacity (id) VALUES (1);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT NOT NULL,
  association TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  received_at INTEGER,
  reviewed_at INTEGER,
  reviewed_by TEXT
);
CREATE INDEX submissions_owner ON submissions(user_id, created_at DESC, id DESC);
CREATE INDEX submissions_queue ON submissions(created_at DESC, id DESC);

CREATE TABLE submission_files (
  id TEXT NOT NULL,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  ordinal INTEGER NOT NULL,
  name TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes > 0 AND bytes <= 50000000),
  sha256 TEXT NOT NULL,
  media_type TEXT NOT NULL,
  uploaded_at INTEGER,
  PRIMARY KEY (submission_id, id),
  UNIQUE (submission_id, ordinal)
);

CREATE TABLE submission_reviews (
  id INTEGER PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  reviewer_id TEXT NOT NULL,
  reviewed_at INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('reviewed', 'reopened'))
);

-- Conditional SELECT avoids D1's remote CASE/END statement-splitting ambiguity.
CREATE TRIGGER submission_limits BEFORE INSERT ON submissions BEGIN
  SELECT RAISE(ABORT, 'FAMILY_SUBMISSIONS_LIMIT')
    WHERE (SELECT submission_count FROM submission_capacity WHERE id = 1) >= 5000;
  SELECT RAISE(ABORT, 'FAMILY_DAILY_LIMIT')
    WHERE (SELECT count(*) FROM submissions
    WHERE user_id = NEW.user_id AND created_at >= NEW.created_at - 86400000) >= 10;
END;
CREATE TRIGGER submission_count AFTER INSERT ON submissions BEGIN
  UPDATE submission_capacity SET submission_count = submission_count + 1 WHERE id = 1;
END;
CREATE TRIGGER submission_file_limits BEFORE INSERT ON submission_files BEGIN
  SELECT RAISE(ABORT, 'FAMILY_STORAGE_LIMIT')
    WHERE (SELECT reserved_bytes FROM submission_capacity WHERE id = 1) + NEW.bytes + 65536 > 1000000000;
  SELECT RAISE(ABORT, 'FAMILY_FILE_LIMIT')
    WHERE (SELECT count(*) FROM submission_files WHERE submission_id = NEW.submission_id) >= 8
    OR (SELECT coalesce(sum(bytes), 0) FROM submission_files WHERE submission_id = NEW.submission_id) + NEW.bytes > 150000000;
END;
CREATE TRIGGER submission_file_reservation AFTER INSERT ON submission_files BEGIN
  UPDATE submission_capacity SET reserved_bytes = reserved_bytes + NEW.bytes + 65536 WHERE id = 1;
END;
CREATE TRIGGER submission_original_immutable BEFORE UPDATE OF id, user_id, email, title, body, link, association, manifest_sha256, created_at ON submissions BEGIN
  SELECT RAISE(ABORT, 'FAMILY_ORIGINAL_IMMUTABLE');
END;
CREATE TRIGGER submission_file_immutable BEFORE UPDATE OF id, submission_id, ordinal, name, bytes, sha256, media_type ON submission_files BEGIN
  SELECT RAISE(ABORT, 'FAMILY_ORIGINAL_IMMUTABLE');
END;
