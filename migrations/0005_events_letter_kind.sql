-- Erasure asks, letter by letter, whether a report is open; the lookup by letter and kind, ordered by id, needs its own index.
CREATE INDEX events_letter_kind ON events (letter_id, kind, id);
