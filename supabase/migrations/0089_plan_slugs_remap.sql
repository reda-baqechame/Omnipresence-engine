-- Master Plan v4 Phase 3 — remap legacy plan values onto the 3-plan model.
-- audit ($199 one-time) -> solo; tracking ($299) -> growth; enterprise -> agency.
-- Legacy enum labels stay in the type (dropping enum values is unsupported);
-- application code only ever writes free/solo/growth/agency from now on.

UPDATE organizations SET plan = 'solo' WHERE plan = 'audit';
UPDATE organizations SET plan = 'growth' WHERE plan = 'tracking';
UPDATE organizations SET plan = 'agency' WHERE plan = 'enterprise';
