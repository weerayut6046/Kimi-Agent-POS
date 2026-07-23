param(
  [Parameter(Mandatory = $true)]
  [string]$PackagePath,
  [Parameter(Mandatory = $true)]
  [string]$UnpackedDir,
  [Parameter(Mandatory = $true)]
  [string]$IdentityName,
  [Parameter(Mandatory = $true)]
  [string]$Publisher,
  [Parameter(Mandatory = $true)]
  [string]$ApplicationId,
  [switch]$TestIdentity
)

$ErrorActionPreference = "Stop"
$resolvedPackage = (Resolve-Path -LiteralPath $PackagePath).Path
$resolvedUnpackedDir = (Resolve-Path -LiteralPath $UnpackedDir).Path
if ([IO.Path]::GetExtension($resolvedPackage) -ne ".appx") {
  throw "Store artifact must use the .appx extension."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($resolvedPackage)
try {
  $manifestEntry = $archive.GetEntry("AppxManifest.xml")
  if ($null -eq $manifestEntry) {
    throw "AppxManifest.xml is missing from the package."
  }
  if ($null -ne $archive.GetEntry("AppxSignature.p7x")) {
    throw "Pre-submission Store package must be unsigned; unexpected signature found."
  }

  $reader = [IO.StreamReader]::new($manifestEntry.Open())
  try {
    [xml]$manifest = $reader.ReadToEnd()
  } finally {
    $reader.Dispose()
  }
} finally {
  $archive.Dispose()
}

$identity = $manifest.Package.Identity
$application = $manifest.Package.Applications.Application
if ($identity.Name -ne $IdentityName) {
  throw "Identity mismatch: expected '$IdentityName', got '$($identity.Name)'."
}
if ($identity.Publisher -ne $Publisher) {
  throw "Publisher mismatch: expected '$Publisher', got '$($identity.Publisher)'."
}
if ($identity.ProcessorArchitecture -ne "x64") {
  throw "Unexpected package architecture: $($identity.ProcessorArchitecture)."
}
if ($application.Id -ne $ApplicationId) {
  throw "Application ID mismatch: expected '$ApplicationId', got '$($application.Id)'."
}

$fullTrust = $manifest.SelectSingleNode(
  "/*[local-name()='Package']/*[local-name()='Capabilities']/*[local-name()='Capability' and @Name='runFullTrust']"
)
if ($null -eq $fullTrust) {
  throw "The runFullTrust capability is missing."
}

$mainExecutables = @(
  Get-ChildItem -LiteralPath $resolvedUnpackedDir -File -Filter "*.exe"
)
if ($mainExecutables.Count -ne 1) {
  throw "Expected one top-level unpacked application executable; found $($mainExecutables.Count)."
}
$executableSignature = Get-AuthenticodeSignature -LiteralPath $mainExecutables[0].FullName
if ($executableSignature.Status -ne [System.Management.Automation.SignatureStatus]::NotSigned) {
  throw "Pre-submission Store executable must be unsigned; got $($executableSignature.Status)."
}

$size = (Get-Item -LiteralPath $resolvedPackage).Length
[pscustomobject]@{
  File = Split-Path -Leaf $resolvedPackage
  Bytes = $size
  Identity = $identity.Name
  Publisher = $identity.Publisher
  Version = $identity.Version
  Architecture = $identity.ProcessorArchitecture
  ApplicationId = $application.Id
  SignedBeforeStore = $false
  ExecutableSignedBeforeStore = $false
} | Format-List

if ($TestIdentity) {
  Write-Warning "Test identity package only. Partner Center will reject this artifact."
} else {
  Write-Host ">> Store package structure and Partner Center identity verified."
}
