@echo off
REM Double-click this file to start Dear Memory (free version) on Windows.
REM It opens 3 windows: the server, the website, and the phone link (tunnel).
REM Keep all 3 windows open while people use the app. Close them to stop.

cd /d "%~dp0"

if not exist "server\node_modules" (
  echo Installing server packages for the first time...
  call npm.cmd install --prefix server
)
if not exist "client\node_modules" (
  echo Installing website packages for the first time...
  call npm.cmd install --prefix client
)
if not exist "server\.env" (
  copy "server\.env.example" "server\.env" >nul
  echo Created server\.env - open it and set JWT_SECRET to a long random text, then run this file again.
  notepad "server\.env"
  pause
  exit /b
)

start "Dear Memory - server" cmd /k "cd /d "%~dp0server" && npm.cmd run dev"
timeout /t 3 >nul
start "Dear Memory - website" cmd /k "cd /d "%~dp0client" && npm.cmd run dev"

where cloudflared >nul 2>nul
if %errorlevel%==0 (
  timeout /t 5 >nul
  start "Dear Memory - phone link (copy the https://...trycloudflare.com address)" cmd /k "cloudflared tunnel --url http://localhost:5173"
) else (
  echo.
  echo For phones, install the free tunnel once:  winget install --id Cloudflare.cloudflared
  echo Then run this file again.
)

timeout /t 6 >nul
start "" http://localhost:5173
