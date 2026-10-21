@echo off
cd /d "%~dp0"
set "DATADIR=%USERPROFILE%\mysql-lf-data"
set "MYSQLD="
for /f "delims=" %%i in ('where mysqld 2^>nul') do if not defined MYSQLD set "MYSQLD=%%i"
for /d %%d in ("C:\Program Files\MySQL\MySQL Server*") do if not defined MYSQLD if exist "%%d\bin\mysqld.exe" set "MYSQLD=%%d\bin\mysqld.exe"
if not defined MYSQLD if exist "C:\xampp\mysql\bin\mysqld.exe" set "MYSQLD=C:\xampp\mysql\bin\mysqld.exe"
if not defined MYSQLD ( echo Could not find mysqld.exe on this PC. & pause & exit /b 1 )
echo Using MySQL: %MYSQLD%
if not exist "%DATADIR%\mysql" (
  echo Initialising data folder %DATADIR% ...
  "%MYSQLD%" --initialize-insecure --datadir="%DATADIR%"
)
echo Starting MySQL on port 3306...
start "MySQL" /min "%MYSQLD%" --datadir="%DATADIR%" --port=3306 --console
timeout /t 8 /nobreak >nul
call npm run setup
start "" http://localhost:3000
call npm start
pause
