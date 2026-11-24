@echo off
title FoveaStream
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo [FoveaStream] First run: installing dependencies...
  call npm install || (pause & exit /b 1)
)
where streamlink >nul 2>nul || if not exist "%LOCALAPPDATA%\Programs\Streamlink\bin\streamlink.exe" if not exist "%ProgramFiles%\Streamlink\bin\streamlink.exe" if not exist "resources\bin\streamlink\bin\streamlink.exe" (
  echo [FoveaStream] WARNING: Streamlink not found. Install it from https://streamlink.github.io/install.html
)
npm start -- %*
