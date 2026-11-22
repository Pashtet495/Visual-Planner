@echo off
REM ============================================================
REM  Visual Planner - build Windows installer with electron-builder
REM  Requirements: Node.js LTS (https://nodejs.org)
REM  Output: dist folder (NSIS installer + portable exe)
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

echo [INFO] Building Windows package with electron-builder...
call npx electron-builder --win
if errorlevel 1 (
    echo [ERROR] Build failed. See the messages above.
    pause
    exit /b 1
)

echo.
echo [OK] Build finished successfully.
echo Output files are in the "dist" folder:
echo   - Visual Planner Setup .exe  (installer)
echo   - Visual-Planner-Portable .exe  (portable version)
echo.
pause

endlocal
