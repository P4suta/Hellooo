-- The key in every mail to a person opens the page about their address, where the language changes and letters stop; it is no longer only an unsubscribe token.
ALTER TABLE users RENAME COLUMN unsubscribe_token TO page_key;
