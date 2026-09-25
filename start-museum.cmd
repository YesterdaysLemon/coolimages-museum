@echo off
rem Rebuild textures from the coolimages folder, then serve the museum locally.
cd /d "%~dp0"
python tools\build_assets.py || goto :eof
start "" http://localhost:8173/
python -m http.server 8173
