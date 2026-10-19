@echo off
chcp 65001 >nul
title 星尘消除 - 演示服务
cd /d "%~dp0..\game"

REM ---- 选择 Python：优先系统 python / py，再退回内置运行时 ----
set "PY=python"
%PY% --version >nul 2>&1
if errorlevel 1 (
  set "PY=py"
  %PY% --version >nul 2>&1
)
if errorlevel 1 (
  set "PY=C:\Users\dqy20\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
)

echo ============================================
echo   星尘消除 演示服务
echo   地址：http://localhost:8000/?demo=1
echo   （?demo=1 会载入预置进度；正常游玩去掉它）
echo   关闭本窗口即停止服务
echo ============================================
echo.

start "星尘消除-服务" /min "%PY%" -m http.server 8000
timeout /t 2 >nul
start "" "http://localhost:8000/?demo=1"

echo 服务已在后台窗口运行。演示结束后关闭那个最小化窗口即可。
echo.
pause
