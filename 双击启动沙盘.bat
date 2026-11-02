@echo off
title 扑克风云会 沙盘电子版
cd /d %~dp0

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [错误] 未检测到 Node.js 运行环境。
  echo   请先安装 Node.js: https://nodejs.org/  下载 LTS 版本, 一路下一步即可。
  echo.
  pause
  exit /b
)

echo.
echo   扑克风云会 - 沙盘电子版 正在启动...
echo.
echo   本窗口就是服务器, 上课期间请勿关闭。
echo   各小组用手机/电脑浏览器访问下面显示的「局域网访问」地址即可登录。
echo.

start "" /min cmd /c "timeout /t 3 >nul ^& start http://localhost:7100/"

node server.js --port 7100

echo.
echo   服务已停止。
pause
