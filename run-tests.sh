#!/bin/sh
# Headless run of tests.js. Same assertions tests.html shows in a browser.
# jsc ships with macOS inside the JavaScriptCore framework -- no install, no
# package manager, keeping the project dependency-free.
#
# `window = globalThis` mirrors browser semantics, where `window.SA = ...`
# also creates the global `SA`.
set -e
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
[ -x "$JSC" ] || { echo "jsc not found at $JSC -- open tests.html instead"; exit 127; }
cd "$(dirname "$0")"
echo "--- geometry and EXIF ---"
"$JSC" -e 'globalThis.window = globalThis;' geom.js exif.js tests.js
echo
echo "--- index.html glue ---"
"$JSC" smoke.js
