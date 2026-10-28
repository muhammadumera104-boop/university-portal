@echo off
rem Starts the GU TECH API and web app, then opens the site in your browser.
start "GU TECH API" cmd /k "cd /d "%~dp0Back end" && npm run dev"
start "GU TECH Web" cmd /k "cd /d "%~dp0Front end" && npm run dev"
timeout /t 8 /nobreak >nul
start "" http://localhost:5173
