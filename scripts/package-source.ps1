$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputFolder = Join-Path $projectRoot 'deliverables'
New-Item -ItemType Directory -Force -Path $outputFolder | Out-Null
$archivePath = Join-Path $outputFolder 'StrangerTalk-source.zip'
Add-Type -AssemblyName System.IO.Compression
$archiveStream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::Create)
$archive = [System.IO.Compression.ZipArchive]::new($archiveStream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  $rootFiles = @('package.json','package-lock.json','tsconfig.json','vite.config.ts','capacitor.config.ts','playwright.config.ts','index.html','.gitignore','.env.example','README.md')
  $sourceFiles = @($rootFiles | ForEach-Object { Get-Item -LiteralPath (Join-Path $projectRoot $_) })
  foreach ($folder in @('.github','.devcontainer','android','public','scripts','src','supabase','tests','docs')) {
    $sourceFiles += Get-ChildItem -LiteralPath (Join-Path $projectRoot $folder) -Recurse -Force -File
  }
  foreach ($sourceFile in $sourceFiles) {
    $relativePath = [System.IO.Path]::GetRelativePath($projectRoot,$sourceFile.FullName).Replace('\','/')
    if ($relativePath -match '^android/(.*/)?(build|\.gradle|\.idea|capacitor-cordova-android-plugins)/' -or
      $relativePath -match '^android/app/src/main/assets/' -or
      $relativePath -eq 'android/local.properties' -or $relativePath -eq 'android/app/src/main/res/xml/config.xml') { continue }
    $entry = $archive.CreateEntry($relativePath,[System.IO.Compression.CompressionLevel]::Optimal)
    $entryStream = $entry.Open()
    $inputStream = [System.IO.File]::OpenRead($sourceFile.FullName)
    try { $inputStream.CopyTo($entryStream) } finally { $inputStream.Dispose(); $entryStream.Dispose() }
  }
} finally { $archive.Dispose(); $archiveStream.Dispose() }
$checksum = Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
"$($checksum.Hash.ToLower())  StrangerTalk-source.zip" | Set-Content -LiteralPath (Join-Path $outputFolder 'SHA256SUMS.txt')
Get-Item -LiteralPath $archivePath | Select-Object FullName,Length
$reader = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  $names = @($reader.Entries | ForEach-Object FullName)
  foreach ($required in @('.github/workflows/android.yml','.env.example','android/gradle/wrapper/gradle-wrapper.jar','supabase/migrations/202610170001_strangertalk.sql','src/App.tsx')) {
    if ($required -notin $names) { throw "Missing required source entry: $required" }
  }
  if ($names | Where-Object { $_ -match '(^|/)(node_modules|\.local|signing-backup|\.env\.local)(/|$)|\.(jks|keystore|apk)$' }) { throw 'Unexpected private or generated content in source archive.' }
  "Verified $($names.Count) archive entries, including hidden workflow files."
} finally { $reader.Dispose() }
