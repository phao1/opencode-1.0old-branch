param([Parameter(Mandatory = $true)][string]$Project)
$ErrorActionPreference = 'Stop'
Push-Location (Resolve-Path $Project)
try { & node (Join-Path $PSScriptRoot 'one-shot.mjs') worker; $result = $LASTEXITCODE }
finally { Pop-Location }
exit $result
