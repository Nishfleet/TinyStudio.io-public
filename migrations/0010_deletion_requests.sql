-- Data deletion requests from the contact page (#132). A visitor asks for the
-- data held for their email to be deleted; the row records the request and
-- handled_at marks it done once the owner has deleted what is held.
CREATE TABLE IF NOT EXISTS deletion_requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  handled_at TEXT
);
