-- Language the tutor and generated material use for this space (BCP-47 code). NULL follows the app language.
-- Numbered 018 because 017 is reserved for another branch. The runner applies migrations by position, so renumber here, in MIGRATIONS and in DETECTED when 017 lands.
ALTER TABLE spaces ADD COLUMN language TEXT;
