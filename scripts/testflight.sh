#!/bin/zsh
# Archive a Release build and upload it to App Store Connect for TestFlight.
#
#   ./scripts/testflight.sh            archive and upload
#   ./scripts/testflight.sh --archive  archive only (ios/build/VGANGBattle.xcarchive)
#   ./scripts/testflight.sh --upload   upload the last archive again (no rebuild)
#
# Signs with team SL53MJAWWY. Either sign in to Xcode (Settings > Accounts) with an
# Apple ID that has App Store Connect access to that team, or use an App Store
# Connect API key (Users and Access > Integrations > App Store Connect API):
#
#   ASC_KEY_ID=XXXXXXXXXX ASC_ISSUER_ID=xxxxxxxx-xxxx-... ASC_KEY_PATH=~/keys/AuthKey_XXXXXXXXXX.p8 ./scripts/testflight.sh
#
# The app record for studio.vgang.battle must exist in App Store Connect (My Apps > +).
# Each archive gets a new build number (the time, yymmddHHMM).
set -euo pipefail
cd "$(dirname "$0")/../ios"

AUTH=()
if [[ -n "${ASC_KEY_ID:-}" ]]; then
  AUTH=(-authenticationKeyPath "${ASC_KEY_PATH/#\~/$HOME}" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

if [[ "${1:-}" != "--upload" ]]; then
  BUILD=$(date +%y%m%d%H%M)
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD" VGANGBattle/Info.plist
  echo "[testflight] build $BUILD"
  xcodebuild -workspace VGANGBattle.xcworkspace -scheme VGANGBattle -configuration Release \
    -destination "generic/platform=iOS" -archivePath build/VGANGBattle.xcarchive \
    -allowProvisioningUpdates "${AUTH[@]}" DEVELOPMENT_TEAM=SL53MJAWWY archive | tail -3
  [[ "${1:-}" == "--archive" ]] && exit 0
fi

xcodebuild -exportArchive -archivePath build/VGANGBattle.xcarchive \
  -exportOptionsPlist ExportOptions-TestFlight.plist -exportPath build/testflight \
  -allowProvisioningUpdates "${AUTH[@]}" | tail -5
echo "[testflight] uploaded: it shows in App Store Connect > TestFlight once Apple has processed it (10-30 min)"
