-- The language a person reads replies, delivered letters, and pages in; a BCP 47 primary subtag.
ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';
