#!/bin/bash
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 &
sleep 2
fluxbox &
x11vnc -display :99 -nopw -listen localhost -xkb -ncache 10 -ncache_cr -forever &
websockify --web /usr/share/novnc/ 6080 localhost:5900 &
google-chrome --no-sandbox --disable-dev-shm-usage --user-data-dir=/workspaces/my-browser-agent/chrome_profile --remote-debugging-port=9222 "https://github.com/login" &
echo "Real-time Interactive Browser running on Port 6080!"
