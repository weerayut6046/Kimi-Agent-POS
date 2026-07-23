# Desktop public-trust signing and release

Production Windows releases must be signed by an Authenticode certificate that
chains to a CA in the Microsoft Trusted Root Program. The repository's
self-signed `PumpPOS Code Signing` identity is for controlled development only;
it must never be uploaded to the production update bucket.

## Signing credentials

Provide the public-trust PFX and password outside the repository:

```powershell
$env:WIN_CSC_LINK = "C:\secure\publisher-code-signing.pfx"
$env:WIN_CSC_KEY_PASSWORD = "<read from a local secret manager>"
npm run dist:exe
```

Never commit the PFX, paste its password into chat or logs, or place either
value in a frontend environment variable. CI must store both values as masked
secrets. `desktop/certs/*.pfx` and `desktop/certs/pfx-password.txt` remain
ignored only for the explicit self-signed development command:

```powershell
npm run dist:exe:self-signed
```

The normal `dist:exe` command fails before packaging when external signing
credentials are absent. After packaging it verifies the installer, portable
executable, and unpacked application. All must have a valid signature, a
timestamp, and a non-self-signed publisher. `publish:gcs` repeats this gate
before uploading any file.

## Publisher transition from 2.1.3

Installed version 2.1.3 trusts only `CN=PumpPOS Code Signing` in its generated
`app-update.yml`. A new public certificate will normally use the legal identity
validated by the CA, so 2.1.3 may reject the automatic update even when Windows
trusts the new installer. Treat 2.1.4 as a publisher-transition release:

1. record the exact public certificate subject after it is issued;
2. build and verify 2.1.4 with that certificate;
3. test a 2.1.3-to-2.1.4 update on an isolated copy of production data;
4. if the updater rejects the new publisher, distribute 2.1.4 as a manual
   installer to existing stations and preserve their application data;
5. confirm newly installed 2.1.4 metadata trusts the public publisher before
   restoring normal automatic releases.

Do not upload `latest.yml`, tag `v2.1.4`, or replace the public download until
the clean-machine Smart App Control test and the 2.1.3 publisher-transition
test both pass.
