$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "../..")
$Launcher = Join-Path $RepoRoot "scripts/dev/run_backend.py"

if ($env:SIMWORKBENCH_LAUNCHER_PYTHON) {
  & $env:SIMWORKBENCH_LAUNCHER_PYTHON $Launcher @args
  exit $LASTEXITCODE
}

$Candidates = @(
  (Join-Path $RepoRoot ".venv/Scripts/python.exe"),
  (Join-Path $RepoRoot ".venv/Scripts/python"),
  (Join-Path $RepoRoot ".venv/bin/python")
)

foreach ($Candidate in $Candidates) {
  if (Test-Path $Candidate) {
    & $Candidate $Launcher @args
    exit $LASTEXITCODE
  }
}

if (Get-Command python -ErrorAction SilentlyContinue) {
  & python $Launcher @args
  exit $LASTEXITCODE
}

if (Get-Command py -ErrorAction SilentlyContinue) {
  & py -3 $Launcher @args
  exit $LASTEXITCODE
}

Write-Error "No Python interpreter found. Run scripts/dev/install.sh first or set SIMWORKBENCH_LAUNCHER_PYTHON."
exit 127
