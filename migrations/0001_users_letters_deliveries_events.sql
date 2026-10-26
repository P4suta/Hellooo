-- Timestamps are milliseconds since the Unix epoch.
-- A user holds one receive credit per accepted letter, and a delivery spends one.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'unsubscribed', 'suppressed', 'banned')),
  credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  verify_token TEXT UNIQUE,
  unsubscribe_token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  verified_at INTEGER
);

CREATE TABLE letters (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_verification', 'pending_confirmation', 'rejected', 'held', 'traveling', 'delivered', 'lost')),
  confirm_token TEXT UNIQUE,
  moderation TEXT,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  deliver_after INTEGER
);

CREATE INDEX letters_due ON letters (status, deliver_after);
CREATE INDEX letters_sender_accepted ON letters (sender_id, accepted_at);

CREATE TABLE deliveries (
  letter_id TEXT PRIMARY KEY REFERENCES letters(id),
  recipient_id TEXT NOT NULL REFERENCES users(id),
  report_token TEXT NOT NULL UNIQUE,
  provider_message_id TEXT,
  sent_at INTEGER NOT NULL
);

CREATE INDEX deliveries_recipient ON deliveries (recipient_id);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  user_id TEXT,
  letter_id TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX events_user_kind ON events (user_id, kind, created_at);
