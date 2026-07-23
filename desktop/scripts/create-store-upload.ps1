param(
  [Parameter(Mandatory = $true)]
  [string]$PackagePath
)

$ErrorActionPreference = "Stop"
$resolvedPackage = (Resolve-Path -LiteralPath $PackagePath).Path
$directory = Split-Path -Parent $resolvedPackage
$baseName = [IO.Path]::GetFileNameWithoutExtension($resolvedPackage)
$uploadPath = Join-Path $directory "$baseName.appxupload"
$temporaryZip = "$uploadPath.zip"

Compress-Archive `
  -LiteralPath $resolvedPackage `
  -DestinationPath $temporaryZip `
  -CompressionLevel NoCompression `
  -Force
Move-Item -LiteralPath $temporaryZip -Destination $uploadPath -Force

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($uploadPath)
try {
  $entries = @($archive.Entries)
  if ($entries.Count -ne 1) {
    throw "Expected one package inside appxupload; found $($entries.Count)."
  }
  if ($entries[0].Name -ne (Split-Path -Leaf $resolvedPackage)) {
    throw "Unexpected appxupload entry: $($entries[0].Name)."
  }
} finally {
  $archive.Dispose()
}

$item = Get-Item -LiteralPath $uploadPath
[pscustomobject]@{
  File = $item.Name
  Bytes = $item.Length
  Contains = Split-Path -Leaf $resolvedPackage
} | Format-List
Write-Host ">> Microsoft Store upload container created."
