@echo off
REM ============================================================
REM  Visual Planner - run in development mode (without packaging)
REM  Requirements: Node.js LTS (https://nodejs.org)
REM ============================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js LTS from https://nodejs.org and run this script again.
    pause
    exit /b 1
)

if not exist node_modules (
    echo [INFO] First run: installing dependencies, please wait...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed. Check your internet connection and try again.
        pause
        exit /b 1
    )
)

echo [INFO] Starting Visual Planner...
call npm start

endlocal
