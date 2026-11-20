@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
)

where node >nul 2>nul
if errorlevel 1 goto missing_node
where npm.cmd >nul 2>nul
if errorlevel 1 goto missing_npm

if not exist ".env" if exist ".env.example" (
    copy /Y ".env.example" ".env" >nul
    if errorlevel 1 goto env_failed
)

if not exist "node_modules\vite\bin\vite.js" goto install_dependencies
if not exist "node_modules\concurrently\dist\bin\concurrently.js" goto install_dependencies
goto start_app

:install_dependencies
echo Dang cai dat cac thu vien can thiet...
call npm.cmd install
if errorlevel 1 goto install_failed

:start_app
echo.
echo Dang khoi dong ung dung Nhip Nhom...
echo Khi may chu san sang, mo http://localhost:5173
echo Nhan Ctrl+C de dung ca giao dien va API.
echo.
call npm.cmd run dev
set "APP_EXIT_CODE=%ERRORLEVEL%"
echo.
echo Ung dung da dung voi ma loi %APP_EXIT_CODE%.
pause
exit /b %APP_EXIT_CODE%

:missing_node
echo Khong tim thay Node.js. Hay cai Node.js 20 tro len, sau do mo lai file nay.
pause
exit /b 1

:missing_npm
echo Khong tim thay npm.cmd. Hay cai lai Node.js kem npm, sau do mo lai file nay.
pause
exit /b 1

:env_failed
echo Khong tao duoc file .env tu .env.example.
pause
exit /b 1

:install_failed
echo Cai dat thu vien that bai. Kiem tra ket noi mang va thu chay npm.cmd install.
pause
exit /b 1
