param(
  [switch]$AllowSelfSigned
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$package = Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$version = $package.version
$releaseDir = Join-Path $root "release"
$unpackedDir = Join-Path $releaseDir "win-unpacked"
$unpackedExecutables = @(
  Get-ChildItem -LiteralPath $unpackedDir -File -Filter "*.exe"
)
if ($unpackedExecutables.Count -ne 1) {
  throw "Expected exactly one top-level unpacked app executable; found $($unpackedExecutables.Count)"
}
$targets = @(
  (Join-Path $releaseDir "POS-Pump-Setup-$version.exe"),
  (Join-Path $releaseDir "POS-Pump-Portable-$version.exe"),
  $unpackedExecutables[0].FullName
)

$results = @()
foreach ($target in $targets) {
  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    throw "Missing release file: $target"
  }

  $signature = Get-AuthenticodeSignature -LiteralPath $target
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "Invalid signature for $(Split-Path -Leaf $target): $($signature.Status)"
  }
  if ($null -eq $signature.SignerCertificate) {
    throw "Missing signer certificate for $(Split-Path -Leaf $target)"
  }
  if ($null -eq $signature.TimeStamperCertificate) {
    throw "Missing trusted timestamp for $(Split-Path -Leaf $target)"
  }

  $selfSigned = $signature.SignerCertificate.Subject -eq $signature.SignerCertificate.Issuer
  if ($selfSigned -and -not $AllowSelfSigned) {
    throw "Production release cannot use a self-signed certificate: $(Split-Path -Leaf $target)"
  }

  $results += [pscustomobject]@{
    File = Split-Path -Leaf $target
    Status = $signature.Status
    Publisher = $signature.SignerCertificate.Subject
    Issuer = $signature.SignerCertificate.Issuer
    Timestamped = $true
    SelfSigned = $selfSigned
  }
}

$results | Format-Table -AutoSize
if ($AllowSelfSigned) {
  Write-Warning "Self-signed development build: do not upload these artifacts to production."
} else {
  Write-Host ">> Public-trust signatures and timestamps verified for all executables."
}
