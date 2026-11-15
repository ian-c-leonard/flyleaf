-- Family cards. A relative types the code from a printed card, chooses the
-- email address they will sign in with, and proves it with an emailed code.
-- The code itself is never stored, only its SHA-256. A card lets its email in
-- only once it is confirmed: the code and a sign-in with that email together.
CREATE TABLE cards (
  code_hash TEXT PRIMARY KEY CHECK (length(code_hash) = 64),
  person TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  email TEXT,
  email_changes INTEGER NOT NULL DEFAULT 0,
  chosen_at INTEGER,
  confirmed_at INTEGER
);
CREATE INDEX cards_email ON cards(email);

-- How many wrong codes arrived, so codes cannot be guessed. A bucket names
-- an hour or a day; an address is held only as a hash.
CREATE TABLE card_attempts (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
