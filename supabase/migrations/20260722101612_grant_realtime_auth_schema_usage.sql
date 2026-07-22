-- Realtime evaluates the policy as the authenticated caller. It needs to
-- resolve the allowlisted helper in the private application schema, but it
-- receives no table privileges and the pos schema is not exposed by Data API.
grant usage on schema pos to authenticated;
