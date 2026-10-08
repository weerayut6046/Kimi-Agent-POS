-- Remove encrypted face templates after retiring face enrollment and verification.
-- Keep staff credentials, passkeys, and historical attendance records.
DROP TABLE IF EXISTS "pos"."employee_face_profiles";
