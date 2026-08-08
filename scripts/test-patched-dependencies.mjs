import path from 'node:path';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';

const require = createRequire(import.meta.url);
const mobileRoot = path.resolve('packages/mobile');
const expoManifest = require.resolve('expo/package.json', { paths: [mobileRoot] });
const expoRequire = createRequire(expoManifest);
const imageSizeModule = expoRequire.resolve('image-size');

const fixtures = [
  {
    name: 'ICNS zero-length entry (CVE-2025-71330)',
    bytes: (() => {
      const input = Buffer.alloc(16);
      input.write('icns', 0, 'ascii');
      input.writeUInt32BE(input.length, 4);
      input.write('ic07', 8, 'ascii');
      input.writeUInt32BE(0, 12);
      return [...input];
    })(),
  },
  {
    name: 'JXL zero-sized box (CVE-2025-71329)',
    bytes: (() => {
      const input = Buffer.alloc(32);
      input.writeUInt32BE(12, 0);
      input.write('JXL ', 4, 'ascii');
      input.writeUInt32BE(12, 12);
      input.write('ftyp', 16, 'ascii');
      input.write('jxl ', 20, 'ascii');
      input.writeUInt32BE(0, 24);
      input.write('jxlp', 28, 'ascii');
      return [...input];
    })(),
  },
];

const workerSource = String.raw`
  const { parentPort, workerData } = require('node:worker_threads');
  const imageSize = require(workerData.imageSizeModule);
  try {
    imageSize(Uint8Array.from(workerData.bytes));
    parentPort.postMessage({ threw: false });
  } catch {
    parentPort.postMessage({ threw: true });
  }
`;

async function assertRejectedPromptly(fixture) {
  const worker = new Worker(workerSource, {
    eval: true,
    workerData: { bytes: fixture.bytes, imageSizeModule },
  });

  let timeout;
  try {
    const result = await new Promise((resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`${fixture.name} did not terminate within 1 second`)),
        1_000,
      );
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', (code) => {
        if (code !== 0) reject(new Error(`${fixture.name} worker exited with code ${code}`));
      });
    });

    if (!result.threw) {
      throw new Error(`${fixture.name} was accepted instead of rejected`);
    }
    console.log(`patched-dependency: ok - ${fixture.name}`);
  } finally {
    clearTimeout(timeout);
    await worker.terminate();
  }
}

for (const fixture of fixtures) {
  await assertRejectedPromptly(fixture);
}

console.log('patched-dependencies: ok');
