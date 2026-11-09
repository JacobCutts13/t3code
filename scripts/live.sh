#!/bin/sh
# `vp run live`: run T3 from this checkout (server 13773, web 5733, hot reload) on the same data and
# T3 Connect link as the stock background service (~/.t3). Both use ~/.t3/userdata, so the stock
# service is stopped and kept from starting at login. Both lines are no-ops when already done.
launchctl bootout "gui/$(id -u)/com.t3tools.t3code.service" 2>/dev/null
launchctl disable "gui/$(id -u)/com.t3tools.t3code.service" 2>/dev/null
exec node scripts/dev-runner.ts dev --home-dir ~/.t3 "$@"
