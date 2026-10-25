import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(path.resolve('packages/mobile/package.json'));
const expoRequire = createRequire(require.resolve('expo/package.json'));
const metroRequire = createRequire(expoRequire.resolve('metro/package.json'));
const assetModule = metroRequire.resolve('./src/Assets.js');
const { getAssetData, getAssetSize } = metroRequire(assetModule);
const directory = mkdtempSync(path.join(tmpdir(), 'axiom-metro-assets-'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXa0AAAAASUVORK5CYII=', 'base64');
try {
  const file = path.join(directory, 'pixel.png');
  writeFileSync(file, png);
  const asset = await getAssetData(file, 'pixel.png', [], 'android', '/assets');
  assert.equal(asset.width, 1); assert.equal(asset.height, 1);
  assert.equal(asset.type, 'png'); assert.deepEqual(asset.scales, [1]);
  assert.deepEqual(getAssetSize('png', png, file), { width: 1, height: 1 });
  const zipDirectory = path.join(directory, 'archive.zip');
  mkdirSync(zipDirectory);
  const zipFile = path.join(zipDirectory, 'pixel.png');
  writeFileSync(zipFile, png);
  // Real filesystem bytes exercise Metro's existing .zip/ branch. This does
  // not claim to test a Yarn virtual ZIP filesystem.
  const zipAsset = await getAssetData(zipFile.replaceAll('\\', '/'), 'pixel.png', [], 'android', '/assets');
  assert.equal(zipAsset.width, 1); assert.equal(zipAsset.height, 1);
  const text = path.join(directory, 'plain.txt');
  writeFileSync(text, 'non-image fixture');
  const nonImage = await getAssetData(text, 'plain.txt', [], 'android', '/assets');
  assert.equal(nonImage.width, undefined); assert.equal(nonImage.height, undefined);
  const invalid = path.join(directory, 'invalid.png');
  writeFileSync(invalid, 'not an image');
  await assert.rejects(getAssetData(invalid, 'invalid.png', [], 'android', '/assets'));
  // Load a reverted copy in memory; never modify installed packages or caches.
  const installed = readFileSync(assetModule, 'utf8');
  const patched = `  const dimensions = !isImage
    ? null
    : assetInfo.files[0].includes(".zip/")
      ? (0, _imageSize.default)(_fs.default.readFileSync(assetInfo.files[0]))
      : await imageSizeFromFile(assetInfo.files[0]);`;
  assert.equal(installed.split(patched).length, 2, 'Expected exact compatibility patch');
  const original = `  const isImageInput = assetInfo.files[0].includes(".zip/")
    ? _fs.default.readFileSync(assetInfo.files[0])
    : assetInfo.files[0];
  const dimensions = isImage ? (0, _imageSize.default)(isImageInput) : null;`;
  const reverted = { exports: {} };
  new Function('require', 'module', 'exports', installed.replace(patched, original))(
    createRequire(assetModule), reverted, reverted.exports,
  );
  await assert.rejects(
    reverted.exports.getAssetData(file, 'pixel.png', [], 'android', '/assets'),
    { code: 'ERR_INVALID_ARG_TYPE' },
  );
  console.log('metro-image-assets: ok - PNG file, byte input, ZIP-path branch, non-image asset, invalid-image rejection and reverted-patch negative control');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
