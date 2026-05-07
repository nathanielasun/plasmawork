@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%..\.."
set "LAUNCHER=%REPO_ROOT%\scripts\dev\run_backend.py"

if not "%SIMWORKBENCH_LAUNCHER_PYTHON%"=="" (
  "%SIMWORKBENCH_LAUNCHER_PYTHON%" "%LAUNCHER%" %*
  exit /b %ERRORLEVEL%
)

if exist "%REPO_ROOT%\.venv\Scripts\python.exe" (
  "%REPO_ROOT%\.venv\Scripts\python.exe" "%LAUNCHER%" %*
  exit /b %ERRORLEVEL%
)

if exist "%REPO_ROOT%\.venv\Scripts\python" (
  "%REPO_ROOT%\.venv\Scripts\python" "%LAUNCHER%" %*
  exit /b %ERRORLEVEL%
)

if exist "%REPO_ROOT%\.venv\bin\python" (
  "%REPO_ROOT%\.venv\bin\python" "%LAUNCHER%" %*
  exit /b %ERRORLEVEL%
)

python "%LAUNCHER%" %*
if not errorlevel 9009 exit /b %ERRORLEVEL%

py -3 "%LAUNCHER%" %*
if not errorlevel 9009 exit /b %ERRORLEVEL%

echo No Python interpreter found. Run scripts/dev/install.sh first or set SIMWORKBENCH_LAUNCHER_PYTHON. 1>&2
exit /b 127
