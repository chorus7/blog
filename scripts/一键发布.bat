@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."

echo [1/4] 从 Notion 同步文章...
python scripts\sync_notion.py --publish
if errorlevel 1 (
  echo.
  echo [!] 同步失败。检查代理是否开启，或 scripts\notion.env 是否填写正确。
  pause
  exit /b 1
)

echo.
echo [2/4] 检查改动...
git add content/posts
git status --short content/posts
git diff --cached --quiet content/posts
if not errorlevel 1 (
  echo.
  echo [OK] 没有新文章，无需推送。
  pause
  exit /b 0
)

echo.
echo [3/4] 提交...
for /f "tokens=1-3 delims=/ " %%a in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd'"') do set TODAY=%%a
git commit -m "同步 Notion 文章 %TODAY%"

echo.
echo [4/4] 推送...
git push origin main
if errorlevel 1 (
  echo.
  echo [!] 推送失败。网站未更新，本地提交已保留。
  pause
  exit /b 1
)

echo.
echo [OK] 已推送。约 1 分钟后访问 https://chorus7.github.io/blog/
pause
