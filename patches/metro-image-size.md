# Metro 0.84.4 and image-size 2 compatibility

The root override retains image-size 2.0.3 for its security fixes. Metro 0.84.4
declares image-size ^1.0.2 and passes ordinary image file paths to the synchronous
imageSize API. Version 2 accepts bytes there, so development bundles containing
React Native LogBox images fail with ERR_INVALID_ARG_TYPE in TextDecoder.

The pinned Metro patch uses imageSizeFromFile for ordinary file paths, awaiting
its result in the already asynchronous getAssetData function. ZIP-backed paths
retain the existing synchronous virtual-filesystem read and byte-input parser.
Non-image assets are not parsed as images. No security override is removed.

`node scripts/test-metro-image-assets.mjs` exercises installed Metro directly.
The unpatched installation reproduced the emulator's failure before the patch;
the script also checks the reverted implementation in isolation. CI runs this
before the existing Android/iOS Hermes export rehearsal. Production exports
alone had missed this development-only LogBox asset path.

Remove the patch when a tested Metro release supports image-size 2 file input.
Upstream API: https://github.com/image-size/image-size#usage
Security requirement: https://github.com/advisories/GHSA-w3rx-r6r6-pgpr
