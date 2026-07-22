-- Keep future functions in the private application schema from becoming
-- callable through PostgreSQL's default PUBLIC EXECUTE grant. Explicit grants
-- for a narrowly scoped internal function must be added in its own migration.
alter default privileges
  revoke execute on functions from public;

alter default privileges
  revoke execute on functions from anon;

alter default privileges
  revoke execute on functions from authenticated;

alter default privileges in schema pos
  revoke execute on functions from public;

alter default privileges in schema pos
  revoke execute on functions from anon;

alter default privileges in schema pos
  revoke execute on functions from authenticated;
