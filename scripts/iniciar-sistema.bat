@echo off
title MERCHANDISING PRO - Servidor
echo Iniciando MERCHANDISING PRO...
cd /d "%~dp0..\backend"
start "" "http://localhost:3001"
node src/server.js
pause
