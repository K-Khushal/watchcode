# WatchCode APK Installation Guide

_Placeholder — will be filled in once the Wear OS app reaches a releasable state (Slice 3+)._

## Prerequisites

- Galaxy Watch 6 (or any Wear OS 4 device)
- ADB installed on your Mac/PC
- Developer Mode enabled on the watch

## Steps

1. Download the latest `watchcode.apk` from the [GitHub Releases](https://github.com/K-Khushal/watchcode/releases) page.
2. Enable ADB debugging on the watch: **Settings → Developer options → ADB debugging → On**.
3. Connect watch over Wi-Fi: note the IP address shown in Developer options.
4. Run: `adb connect <watch-ip>:5555`
5. Run: `adb install watchcode.apk`
6. Open WatchCode on the watch and follow the pairing prompts.
