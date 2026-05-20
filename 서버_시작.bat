@echo off
title KEPCO Pluglink Server
cd /d "%~dp0"
echo ================================================
echo   KEPCO Pluglink - Local Server
echo ================================================
echo.
echo   URL : http://localhost:8765
echo.
echo   Stop: Ctrl+C  or close this window
echo ================================================
echo.

start "" cmd /c "timeout /t 3 >nul && start http://localhost:8765"

npx --yes http-server -p 8765 -c-1 --cors

pause
