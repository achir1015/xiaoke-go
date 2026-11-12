#!/bin/bash
# 依序封存 iPhone／iPad 版與 Mac 版（App Store），完成後 ios/build/both.done 寫 ok 或 fail
cd "$(dirname "$0")"
mkdir -p build
rm -f build/both.done
bash build-appstore.sh && cp build/store.log build/store-ios.log && bash build-appstore.sh mac && cp build/store.log build/store-mac.log && echo ok > build/both.done || echo fail > build/both.done
