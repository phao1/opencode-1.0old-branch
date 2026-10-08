param(
  [Parameter(Mandatory = $true)][string]$Project,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$OpenCodeArgs
)
$ErrorActionPreference = 'Stop'
$oldConfig = $env:OPENCODE_CONFIG_DIR
$oldProjectConfig = $env:OPENCODE_DISABLE_PROJECT_CONFIG
Push-Location (Resolve-Path $Project)
try {
  $env:OPENCODE_CONFIG_DIR = Join-Path $PSScriptRoot '.opencode'
  $env:OPENCODE_DISABLE_PROJECT_CONFIG = 'true'
  & (Join-Path $PSScriptRoot 'opencode.exe') @OpenCodeArgs; $result = $LASTEXITCODE
}
finally { $env:OPENCODE_CONFIG_DIR = $oldConfig; $env:OPENCODE_DISABLE_PROJECT_CONFIG = $oldProjectConfig; Pop-Location }
exit $result
