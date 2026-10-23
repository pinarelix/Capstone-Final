@echo off
setlocal enabledelayedexpansion

:: ================================================================
::  Barangay 179 Crime BI - Smart Launcher
:: ================================================================
::  First run:  checks prerequisites, installs deps, creates DB,
::              seeds test data, then launches the app.
::  Later runs: detects everything is ready and launches immediately.
::
::  Flags:
::    --reset    Force a full DB reset + re-seed (even if already set up)
::    --setup    Force the full setup flow (even if already set up)
::
::  Demo logins:
::    admin / admin123          (Deputy Officer - full access)
::    captain / captain123      (Kagawad - read-only dashboard)
::    deskofficer / desk123     (Team Leader - day-to-day ops)
:: ================================================================

title Barangay 179 Crime BI
cd /d "%~dp0"

:: -- Parse flags -------------------------------------------------
set "FORCE_RESET=0"
set "FORCE_SETUP=0"
for %%a in (%*) do (
    if "%%a"=="--reset" set "FORCE_RESET=1"
    if "%%a"=="--setup" set "FORCE_SETUP=1"
)

echo.
echo   ============================================================
echo    Barangay 179 Crime BI
echo    Crime Intelligence and Patrol Decision Support System
echo   ============================================================
echo.

:: -- DB config defaults ------------------------------------------
set "DB_HOST=localhost"
set "DB_PORT=3307"
set "DB_USER=root"
set "DB_PASSWORD=admin"
set "DB_NAME=brgydata"

:: Override from backend/.env if it exists
if exist "backend\.env" (
    for /f "usebackq tokens=1,2 delims==" %%a in ("backend\.env") do (
        set "line=%%a"
        if not "!line:~0,1!"=="#" (
            if "%%a"=="DB_HOST"     set "DB_HOST=%%b"
            if "%%a"=="DB_PORT"     set "DB_PORT=%%b"
            if "%%a"=="DB_USER"     set "DB_USER=%%b"
            if "%%a"=="DB_PASSWORD" set "DB_PASSWORD=%%b"
            if "%%a"=="DB_NAME"     set "DB_NAME=%%b"
        )
    )
)

:: ================================================================
::  PREREQUISITE CHECKS
:: ================================================================
echo   Checking prerequisites...
echo.

:: -- Node.js -----------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
    echo   [MISSING] Node.js is not installed or not on PATH.
    echo.
    echo             Download it from https://nodejs.org - LTS recommended.
    echo             After installing, close and reopen this window,
    echo             then run setup.bat again.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set "NODE_VER=%%v"
echo   [OK] Node.js %NODE_VER%

:: -- npm ---------------------------------------------------------
where npm >nul 2>&1
if errorlevel 1 (
    echo   [MISSING] npm is not installed. It should come with Node.js.
    echo             Reinstall Node.js from https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('npm -v') do set "NPM_VER=%%v"
echo   [OK] npm %NPM_VER%

:: -- MySQL CLI ---------------------------------------------------
set "MYSQL_BIN="
where mysql >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=*" %%p in ('where mysql 2^>nul') do if "!MYSQL_BIN!"=="" set "MYSQL_BIN=%%p"
)
if "!MYSQL_BIN!"=="" (
    if exist "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" (
        set "MYSQL_BIN=C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
    )
)
if "!MYSQL_BIN!"=="" (
    if exist "C:\Program Files\MySQL\MySQL Server 9.0\bin\mysql.exe" (
        set "MYSQL_BIN=C:\Program Files\MySQL\MySQL Server 9.0\bin\mysql.exe"
    )
)
if "!MYSQL_BIN!"=="" (
    if exist "C:\xampp\mysql\bin\mysql.exe" (
        set "MYSQL_BIN=C:\xampp\mysql\bin\mysql.exe"
    )
)
if "!MYSQL_BIN!"=="" (
    echo   [MISSING] mysql.exe not found.
    echo.
    echo             Install MySQL 8.0+ and ensure the bin folder is on PATH,
    echo             or install it to the default location:
    echo               C:\Program Files\MySQL\MySQL Server 8.0\bin\
    echo.
    pause
    exit /b 1
)
echo   [OK] MySQL CLI found

:: -- MySQL server connection -------------------------------------
"!MYSQL_BIN!" -h %DB_HOST% -P %DB_PORT% -u %DB_USER% -p%DB_PASSWORD% -e "SELECT 1;" >nul 2>&1
if errorlevel 1 (
    echo   [FAIL] Cannot connect to MySQL at %DB_HOST%:%DB_PORT%.
    echo.
    echo          Make sure the MySQL service is running:
    echo            1. Open Services - Win+R then services.msc
    echo            2. Find "MySQL80" or "MySQL" and click Start
    echo          Or start it from the command line:
    echo            net start MySQL80
    echo.
    echo          If you changed the default port/password, edit backend\.env first.
    echo.
    pause
    exit /b 1
)
echo   [OK] MySQL server responding on port %DB_PORT%

echo.
echo   All prerequisites met.
echo.

:: ================================================================
::  DECIDE: first-time setup or just launch?
:: ================================================================
set "NEEDS_SETUP=0"

if "%FORCE_SETUP%"=="1" (
    set "NEEDS_SETUP=1"
    echo   [FLAG] --setup: forcing full setup flow.
)
if "%FORCE_RESET%"=="1" (
    set "NEEDS_SETUP=1"
    echo   [FLAG] --reset: forcing database reset.
)

if not exist "node_modules" (
    set "NEEDS_SETUP=1"
    echo   [FIRST RUN] node_modules missing - need to install.
)
if not exist "backend\node_modules" (
    set "NEEDS_SETUP=1"
    echo   [FIRST RUN] backend dependencies missing - need to install.
)
if not exist "backend\.env" (
    set "NEEDS_SETUP=1"
    echo   [FIRST RUN] backend/.env missing - need to create.
)

:: Check database has the expected tables with data
"!MYSQL_BIN!" -h %DB_HOST% -P %DB_PORT% -u %DB_USER% -p%DB_PASSWORD% %DB_NAME% -e "SELECT COUNT(*) FROM users;" >nul 2>&1
if errorlevel 1 (
    set "NEEDS_SETUP=1"
    echo   [FIRST RUN] Database not initialized - need to set up.
)

if "!NEEDS_SETUP!"=="0" (
    echo   Everything is ready.
    goto :launch
)

:: ================================================================
::  FULL SETUP
:: ================================================================
echo.
echo   ------------------------------------------------------------
echo   Running first-time setup...
echo   ------------------------------------------------------------
echo.

:: -- 1. npm install ------------------------------------------------
echo   [1/5] Installing dependencies...
call npm install --loglevel=error
if errorlevel 1 (
    echo.
    echo   [ERROR] npm install failed. Check the output above.
    pause
    exit /b 1
)
echo   [OK]   Dependencies installed.
echo.

:: -- 2. Create .env if missing ------------------------------------
echo   [2/5] Checking backend/.env...
if not exist "backend\.env" (
    copy "backend\.env.example" "backend\.env" >nul
    echo   [OK]   Created backend/.env from .env.example
    echo          Edit backend/.env if your MySQL port/password differ.
) else (
    echo   [OK]   backend/.env already exists.
)
echo.

:: -- 3. Create or reset database ----------------------------------
echo   [3/5] Setting up database %DB_NAME%...
if "%FORCE_RESET%"=="1" (
    echo          Dropping existing database per --reset flag...
    "!MYSQL_BIN!" -h %DB_HOST% -P %DB_PORT% -u %DB_USER% -p%DB_PASSWORD% -e "DROP DATABASE IF EXISTS %DB_NAME%;" 2>nul
)
"!MYSQL_BIN!" -h %DB_HOST% -P %DB_PORT% -u %DB_USER% -p%DB_PASSWORD% -e "CREATE DATABASE IF NOT EXISTS %DB_NAME% DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;" 2>nul
if errorlevel 1 (
    echo   [ERROR] Could not create database.
    pause
    exit /b 1
)
echo   [OK]   Database %DB_NAME% ready.
echo.

:: -- 4. Import schema ---------------------------------------------
echo   [4/5] Importing schema...

set "SCHEMA_NEEDED=1"
if not "%FORCE_RESET%"=="1" (
    "!MYSQL_BIN!" -h %DB_HOST% -P %DB_PORT% -u %DB_USER% -p%DB_PASSWORD% %DB_NAME% -e "SELECT COUNT(*) FROM users;" >nul 2>&1
    if not errorlevel 1 (
        set "SCHEMA_NEEDED=0"
        echo   [OK]   Schema already imported - skipping.
    )
)

if "!SCHEMA_NEEDED!"=="1" (
    "!MYSQL_BIN!" -h %DB_HOST% -P %DB_PORT% -u %DB_USER% -p%DB_PASSWORD% %DB_NAME% < "database\schema.sql" 2>nul
    if errorlevel 1 (
        echo   [ERROR] Schema import failed.
        pause
        exit /b 1
    )
    echo   [OK]   17 tables + 72 streets + 3 demo users imported.
)
echo.

:: -- 5. Seed test data --------------------------------------------
echo   [5/5] Seeding test data...
pushd backend
call node scripts/seed-test-data.js
if errorlevel 1 (
    echo   [ERROR] Test data seeding failed.
    popd
    pause
    exit /b 1
)
popd
echo.

:: -- Setup complete -----------------------------------------------
echo   ============================================================
echo   Setup complete!
echo   ============================================================
echo.
echo   Demo logins:
echo     admin / admin123          - Deputy Officer, full access
echo     captain / captain123      - Kagawad, read-only dashboard
echo     deskofficer / desk123     - Team Leader, day-to-day ops
echo.

:: ================================================================
::  LAUNCH
:: ================================================================
:launch
echo   Starting Barangay 179 Crime BI...
echo.
call npm start

endlocal
