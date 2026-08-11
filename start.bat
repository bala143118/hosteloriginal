@echo off
cd /d %~dp0
setlocal
if not exist node_modules (
    echo Installing dependencies...
    npm install || goto :error
)

echo Starting HostelFix backend...
start "HostelFix Server" cmd /k "npm start"

echo Opening frontend in your browser...
timeout /t 2 /nobreak >nul
start "" "http://localhost:5000/"
exit /b 0

:error
echo.
echo Failed to install dependencies. Please check npm and try again.
pause
exit /b 1
