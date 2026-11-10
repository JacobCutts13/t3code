# T3 Code Live launcher

`T3 Code Live.app` starts the hot-reload desktop app (`vp run live`) like a normal Mac app, or brings the
running one forward. It has no window or Dock icon of its own and logs to `~/.t3/live.log`.

Install (the icon comes from the dev app, so it is not committed):

```sh
cp -R "scripts/launcher/T3 Code Live.app" ~/Applications/
mkdir -p ~/Applications/"T3 Code Live.app"/Contents/Resources
cp apps/desktop/.electron-runtime/icon-dev.icns ~/Applications/"T3 Code Live.app"/Contents/Resources/icon.icns
```

It expects this checkout at `~/dev/t3code` and the stock T3 service stopped, because that service holds the
`~/.t3` data lock. Do not pin `T3 Code (Dev).app` itself: it needs the dev server running first.
