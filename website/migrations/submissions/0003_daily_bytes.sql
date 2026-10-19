-- How much one relative may send in a day: 300 MB of files across the
-- submissions they start in any 24 hours (maxDailyBytes in
-- shared/submission-policy.json). One person cannot fill the family inbox.
CREATE TRIGGER submission_daily_bytes BEFORE INSERT ON submission_files BEGIN
  SELECT RAISE(ABORT, 'FAMILY_DAILY_BYTES_LIMIT')
    WHERE (SELECT coalesce(sum(f.bytes), 0) FROM submission_files f
      JOIN submissions s ON s.id = f.submission_id
      JOIN submissions mine ON mine.id = NEW.submission_id
      WHERE s.user_id = mine.user_id AND s.created_at >= mine.created_at - 86400000)
      + NEW.bytes > 300000000;
END;
