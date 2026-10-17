@echo off
cd /d "%~dp0"
if not exist node_modules call npm.cmd install
start "" "http://127.0.0.1:38741"
call npm.cmd start
pause
