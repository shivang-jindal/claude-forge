@echo off
REM ==========================================================================
REM  claude-forge - publish to npm
REM
REM  Double-click this file. It runs the full test + eval gate, then asks for
REM  the 6-digit code from your npm authenticator app and publishes.
REM
REM  (The code rotates every 30 seconds, so the gate runs FIRST and the code
REM  is asked for only when the upload is about to happen.)
REM ==========================================================================
setlocal
cd /d "%~dp0"
echo.
echo   claude-forge publish helper
echo   ===========================
echo.
echo   If you do not have npm credentials on this machine, run this in a
echo   terminal instead:
echo.
echo       npm login --auth-type=web
echo.
echo   Opening your authenticator app now - read the 6-digit npm code.
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo   ERROR: Node.js is not on your PATH. Install Node 24+ and try again.
  echo.
  pause
  exit /b 1
)
node scripts\publish.mjs
set EXITCODE=%ERRORLEVEL%
echo.
if %EXITCODE%==0 (
  echo   Done. Publishing complete.
) else (
  echo   Publishing did not complete (exit code %EXITCODE%).
  echo   See the message above for details.
)
echo.
pause
endlocal
