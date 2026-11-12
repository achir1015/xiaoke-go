#!/bin/bash
# 把 build-appstore.sh 封存好的 iPhone／iPad 與 Mac 版上傳到 App Store Connect（要在 Mac 的終端機 App 裡執行，鑰匙圈才會解鎖）：
#   osascript ios/run-in-terminal.applescript "bash ~/Developer/xiaoke-go/ios/upload-appstore.sh"
# 同一個建置號已經上傳過會回「bundle version must be higher」＝之前已傳成功。進度寫在 ios/build/upload.log
cd "$(dirname "$0")"
rm -f build/upload.done
exec > >(tee build/upload.log) 2>&1
for A in XiaokeGo XiaokeGoMac; do
  echo "== $A"
  xcodebuild -exportArchive -archivePath build/$A-store.xcarchive -exportPath build/upload-$A -exportOptionsPlist ExportUpload.plist -allowProvisioningUpdates 2>&1 | grep -vE "^\s*$" | tail -8
done
echo done > build/upload.done
