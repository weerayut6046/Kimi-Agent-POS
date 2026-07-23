# Windows Store release

PumpPOS uses the Microsoft Store AppX/MSIX path so Microsoft signs the public
package. The repository does not need a public-trust PFX, certificate password,
or hardware token for this release path.

## One-time Partner Center setup

1. Create or verify the Microsoft Partner Center developer account.
2. Reserve the PumpPOS product name.
3. Open **Product management > Product identity**.
4. Copy these exact non-secret values into the current PowerShell session:

```powershell
$env:PUMPPOS_STORE_IDENTITY_NAME = "<Package/Identity/Name>"
$env:PUMPPOS_STORE_PUBLISHER = "<Package/Identity/Publisher>"
$env:PUMPPOS_STORE_PUBLISHER_DISPLAY_NAME = "<Publisher display name>"
```

Do not invent or normalize these values. Partner Center rejects a package when
its identity or publisher differs by even one character. These identifiers are
not passwords, but account credentials and recovery codes must never be placed
in the repository, logs, frontend variables, or chat.

## Build

Before the Partner Center product is available, validate the pipeline with:

```powershell
npm run dist:store:test
```

The test artifact is written to `release/store-test/` and cannot be submitted.
After setting the real Product identity values, build the submission package:

```powershell
npm run dist:store
```

The production `.appx` and recommended `.appxupload` artifacts are written to
`release/store/`. They are deliberately unsigned before submission. Upload the
`.appxupload` file to Partner Center; Microsoft Store signs the package after
certification. Do not distribute either unsigned file directly or upload them
to the legacy GCS updater bucket.

The build verifies the manifest identity, publisher, x64 architecture,
application ID, `runFullTrust` capability, and absence of an accidental local
signature.

## Submission and validation

1. Upload the `.appxupload` from `release/store/` to the Partner Center
   submission.
2. Complete properties, age rating, privacy policy URL or text, screenshots,
   pricing/availability, and certification notes. Add a public support contact
   when one is available.
3. For a controlled first release, keep the listing available only through its
   direct Store link. After certification, install from that link on a clean
   machine before sharing it more broadly.
4. Verify authentication, offline sale/outbox sync, receipt printing, local
   data persistence, uninstall/reinstall behavior, and Store-delivered update.
5. Expand Store availability only after the production smoke test passes.

Store packages never start the NSIS/GCS `electron-updater`; Windows Store owns
their updates. Existing NSIS 2.1.3 installations require one manual migration
to the Store listing. Back up or sync all pending offline sales before that
migration, because MSIX virtualizes application data and uninstall can remove
package-private state.

## Release gates

- Never tag or announce the Store version before certification.
- Never upload the Store artifact to GCS.
- Never submit the `store-test` artifact.
- Do not disable Smart App Control on customer machines.
- Keep the NSIS signing pipeline only as a fallback for future direct EXE
  distribution with a public-trust certificate.
