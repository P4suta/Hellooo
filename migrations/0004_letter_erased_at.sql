-- The instant a letter's text was erased after the retention period that keeps it for reports; NULL while the text is kept.
ALTER TABLE letters ADD COLUMN erased_at INTEGER;
