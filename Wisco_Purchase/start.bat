@echo off
title WISCO Order Tracker
color 0A
cd /d "%~dp0"
echo.
echo  ========================================
echo   WISCO Order Tracker - Starting...
echo  ========================================
echo.
echo  Working folder: %cd%
echo.
where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo  ERROR: Node.js not installed! Get it from nodejs.org
    pause
    exit /b
)
if not exist "node_modules" (
    echo  Installing packages...
    npm install
    echo.
)
echo  Starting server on port 80...
echo.
node server.js
pause
