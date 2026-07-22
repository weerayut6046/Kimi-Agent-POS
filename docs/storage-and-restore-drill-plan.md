# Report/export Storage and restore-drill plan

Reports, exports, and backup procedures stay on Railway until this plan has an
implemented proof of concept and a successful restore drill. A database backup
must never be considered complete merely because a file exists in the same
Supabase project.

## Storage split

### Generated reports and exports

- Use a private Supabase Storage bucket such as `pos-exports`.
- Generate the file server-side after the existing staff/role check. Never put
  a service-role or secret key in the browser.
- Store objects under opaque paths such as
  `<staff-id>/<request-id>/<generated-name>`; do not use customer names, tax ids,
  or session data in object paths.
- Record owner staff id, request id, content type, byte size, checksum, expiry,
  and report parameters in a private application table.
- Return a short-lived signed download URL only after rechecking authorization.
  The URL is a bearer credential and must not be logged or placed in audit
  detail.
- Apply a short lifecycle (target 24 hours, maximum 7 days unless a business
  retention requirement is approved). A cleanup retry must handle objects whose
  metadata row or file was already removed.
- Keep export generation idempotent by request id. A replay returns the same
  completed object while it is still valid and never generates duplicate files.

### Database backups

- Keep Supabase platform daily backups/PITR as the first recovery layer.
- Store independent logical backups in a private GCS bucket outside the
  Supabase project. Supabase database backups include Storage metadata but not
  the underlying Storage objects, and deleting a project also removes its
  in-project backups and Storage files.
- Enable GCS object versioning/retention and lifecycle rules. Use a dedicated
  backup writer identity and a separate restore-reader identity. Neither may be
  used by the frontend.
- Encrypt at rest with the cloud provider/KMS policy and restrict decryption to
  the restore workflow. Do not place encryption keys, database URLs, or access
  tokens in filenames, manifests, application logs, or chat.
- Create backups from a direct Postgres connection intended for management
  commands, not the Edge transaction pooler. Discover and pin the exact
  Supabase CLI/`pg_dump` commands and versions in the implementation runbook.
- Custom-role passwords are not present in platform backup files. After a
  restore, create fresh versioned login roles, disable the old names, and update
  only the isolated environment's Edge secrets.

If persistent Supabase Storage buckets are later introduced, back up their
objects separately through the Storage/S3 API and retain a manifest containing
bucket, object path, version/etag, size, and checksum. Never modify
`storage.objects` directly with SQL.

## Backup artifact and manifest

Each successful backup set contains:

- logical database dump;
- SHA-256 checksum and byte size;
- UTC start/completion times and source project identifier;
- Postgres, Supabase CLI, and dump-tool versions;
- local/remote migration identifiers;
- Storage object manifest and object copy when persistent buckets exist;
- sanitized verification results and retention class.

The manifest contains no passwords, connection strings, secret keys, signed
URLs, staff session tokens, PINs, or customer row data. Upload the dump first,
verify its checksum from GCS, then mark the manifest complete. An incomplete
manifest is not a restorable backup.

## Restore drill

Run at least quarterly and before retiring Railway or changing the backup
format.

1. Obtain cost approval and provision an isolated temporary Supabase project.
   Never restore a drill over production.
2. Record the selected recovery point and target RPO/RTO before starting the
   clock.
3. Download the backup with the restore-reader identity and verify size and
   checksum before opening it.
4. Restore the database using the documented Supabase method for that artifact
   type. Do not mix a full dump with pre-created application tables unless the
   runbook explicitly requires that order.
5. Recreate custom login roles with new passwords and least-privilege grants;
   do not reuse a pooler-cached production credential.
6. Restore persistent Storage objects separately through the Storage/S3 API and
   compare every object to the manifest. Export-cache objects may be omitted by
   policy.
7. Deploy the matching Edge Functions and a temporary web deployment pointed
   only at the isolated project.
8. Run integrity checks, then authenticated browser smoke tests for every route.
   Mutations used in the drill must target disposable test records and verify
   transaction, audit, idempotency, and private Realtime behavior.
9. Record actual RPO/RTO, row/object counts, checksum results, missing roles or
   extensions, manual steps, warnings, and remediation owners.
10. Remove temporary credentials and destroy the isolated project only after
    the drill record is reviewed.

## Minimum integrity checks

- Required schemas, extensions, migrations, functions, RLS policies, grants,
  and versioned login roles are present.
- Core table counts and selected financial aggregates match the backup
  manifest/source snapshot within the declared recovery point.
- Foreign-key/check constraints validate; no sequences lag behind their table
  ids.
- Staff users can authenticate through the temporary app, but inactive users
  and wrong roles remain denied.
- One representative export can be generated, downloaded through a signed URL,
  and becomes inaccessible after expiry.
- A newly generated audit entry and opaque private Realtime invalidation work in
  the isolated environment.
- No production secret is copied to frontend assets, logs, the drill report, or
  the temporary project unless the runbook explicitly requires a rotated,
  isolated replacement.

## Promotion gate for export/backup routes

Do not change the Vercel Railway rewrites for
`reports.exportDailyExcel`, `reports.exportRangeExcel`, or any `dbadmin.*`
procedure until all of the following pass:

- private bucket policies and signed-URL authorization tests;
- export size/time limits, idempotency, cleanup, and failed-upload tests;
- a complete external backup artifact and checksum manifest;
- a successful isolated restore drill within the agreed RPO/RTO;
- security/performance advisors and full repository verification;
- authenticated production browser smoke tests and a tested routing rollback.
