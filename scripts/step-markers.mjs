import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const FORMAT = 'fanthynks-step-marker';
const VERSION = 1;

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function inside(root, target) {
  const path = relative(root, target);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function normalizeRelative(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || value.includes('\\') || isAbsolute(value)) {
    throw new Error(`${label} must be a normalized repository-relative path`);
  }
  const segments = value.split('/');
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`${label} must not contain empty, dot, or parent path segments`);
  }
  return segments.join('/');
}

function safeExistingFile(root, relativePath, label) {
  const normalized = normalizeRelative(relativePath, label);
  const absolute = resolve(root, ...normalized.split('/'));
  if (!inside(root, absolute)) throw new Error(`${label} escapes the repository root`);
  const parts = normalized.split('/');
  let parent = root;
  for (const part of parts.slice(0, -1)) {
    parent = join(parent, part);
    const info = lstatSync(parent);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} traverses a non-directory or symbolic link`);
  }
  const info = lstatSync(absolute);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${label} must be a regular file`);
  const real = resolve(root, relative(root, absolute));
  if (!inside(root, real)) throw new Error(`${label} escapes the repository root`);
  return { absolute, relative: normalized };
}

function safeDestination(root, relativePath, label) {
  const normalized = normalizeRelative(relativePath, label);
  const absolute = resolve(root, ...normalized.split('/'));
  if (!inside(root, absolute)) throw new Error(`${label} escapes the repository root`);
  let parent = root;
  for (const part of normalized.split('/').slice(0, -1)) {
    parent = join(parent, part);
    if (!existsSync(parent)) continue;
    const info = lstatSync(parent);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} traverses a non-directory or symbolic link`);
  }
  if (existsSync(absolute)) {
    const info = lstatSync(absolute);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${label} must be a regular file`);
  }
  return { absolute, relative: normalized };
}

function safeDirectory(root, relativePath, label) {
  const normalized = normalizeRelative(relativePath, label);
  const absolute = resolve(root, ...normalized.split('/'));
  if (!inside(root, absolute)) throw new Error(`${label} escapes the repository root`);
  let parent = root;
  for (const part of normalized.split('/')) {
    parent = join(parent, part);
    if (!existsSync(parent)) continue;
    const info = lstatSync(parent);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must contain only real directories`);
  }
  return { absolute, relative: normalized };
}

function rootFrom(value) {
  const root = resolve(value ?? process.cwd());
  const info = lstatSync(root);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('repository root must be a real directory');
  return root;
}

function parseArgs(args) {
  const parsed = { root: process.cwd(), marker: null, directory: '.axiom/markers', step: null, inputs: [], refresh: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--refresh') parsed.refresh = true;
    else if (arg === '--root' || arg === '--marker' || arg === '--directory' || arg === '--step' || arg === '--input') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === '--root') parsed.root = value;
      else if (arg === '--marker') parsed.marker = value;
      else if (arg === '--directory') parsed.directory = value;
      else if (arg === '--step') parsed.step = value;
      else parsed.inputs.push(value);
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return parsed;
}

function checkMarker(root, markerPath) {
  const marker = safeDestination(root, markerPath, 'marker path');
  const checksum = safeDestination(root, `${marker.relative}.sha256`, 'marker checksum path');
  if (!existsSync(marker.absolute)) {
    if (existsSync(checksum.absolute)) throw new Error(`orphan checksum for ${marker.relative}`);
    return { state: 'RUN', marker: marker.relative };
  }
  if (!existsSync(checksum.absolute)) throw new Error(`marker checksum is missing for ${marker.relative}`);

  const markerBytes = readFileSync(marker.absolute);
  const checksumText = readFileSync(checksum.absolute, 'utf8');
  const expectedMarkerDigest = /^sha256=([a-f0-9]{64})\n?$/.exec(checksumText)?.[1];
  if (!expectedMarkerDigest || digest(markerBytes) !== expectedMarkerDigest) {
    throw new Error(`marker checksum drift for ${marker.relative}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(markerBytes.toString('utf8'));
  } catch {
    throw new Error(`marker manifest is invalid for ${marker.relative}`);
  }
  if (!manifest || manifest.format !== FORMAT || manifest.version !== VERSION
    || typeof manifest.stepId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(manifest.stepId)
    || !Array.isArray(manifest.inputs) || manifest.inputs.length === 0) {
    throw new Error(`marker manifest is invalid for ${marker.relative}`);
  }

  const seen = new Set();
  for (const input of manifest.inputs) {
    if (!input || typeof input.path !== 'string' || typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256)) {
      throw new Error(`marker input entry is invalid for ${marker.relative}`);
    }
    const file = safeExistingFile(root, input.path, 'marker input path');
    if (seen.has(file.relative)) throw new Error(`marker input is duplicated for ${marker.relative}`);
    seen.add(file.relative);
    if (digest(readFileSync(file.absolute)) !== input.sha256) {
      throw new Error(`input checksum drift for ${file.relative}`);
    }
  }
  return { state: 'SKIP', stepId: manifest.stepId, marker: marker.relative };
}

function writeMarker(root, parsed) {
  if (!parsed.marker || !parsed.step || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(parsed.step)) {
    throw new Error('write requires --marker and a valid --step');
  }
  if (!parsed.marker.endsWith('.done')) throw new Error('marker path must end in .done');
  if (parsed.inputs.length === 0) throw new Error('write requires at least one --input');
  const marker = safeDestination(root, parsed.marker, 'marker path');
  const checksum = safeDestination(root, `${marker.relative}.sha256`, 'marker checksum path');
  const markerExists = existsSync(marker.absolute);
  const checksumExists = existsSync(checksum.absolute);
  if (markerExists !== checksumExists) throw new Error(`incomplete existing marker pair for ${marker.relative}`);
  if (markerExists && !parsed.refresh) throw new Error(`marker already exists; use --refresh to rebind ${marker.relative}`);
  if (!markerExists && parsed.refresh) throw new Error(`cannot refresh missing marker ${marker.relative}`);
  if (markerExists) {
    const existingBytes = readFileSync(marker.absolute);
    const existingChecksum = /^sha256=([a-f0-9]{64})\n?$/.exec(readFileSync(checksum.absolute, 'utf8'))?.[1];
    if (!existingChecksum || digest(existingBytes) !== existingChecksum) throw new Error(`marker checksum drift for ${marker.relative}`);
    let existing;
    try {
      existing = JSON.parse(existingBytes.toString('utf8'));
    } catch {
      throw new Error(`marker manifest is invalid for ${marker.relative}`);
    }
    if (existing?.format !== FORMAT || existing?.version !== VERSION || existing?.stepId !== parsed.step) {
      throw new Error(`cannot refresh a different or invalid step marker at ${marker.relative}`);
    }
  }

  const inputs = parsed.inputs.map(inputPath => {
    const file = safeExistingFile(root, inputPath, 'marker input path');
    return { path: file.relative, sha256: digest(readFileSync(file.absolute)) };
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(inputs.map(input => input.path)).size !== inputs.length) throw new Error('write inputs must be unique');

  const manifest = {
    format: FORMAT,
    version: VERSION,
    stepId: parsed.step,
    createdAt: new Date().toISOString(),
    inputs,
  };
  const markerBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  mkdirSync(dirname(marker.absolute), { recursive: true });
  writeFileSync(marker.absolute, markerBytes, { flag: markerExists ? 'w' : 'wx' });
  writeFileSync(checksum.absolute, `sha256=${digest(markerBytes)}\n`, { flag: checksumExists ? 'w' : 'wx' });
  process.stdout.write(`MARKED ${parsed.step} ${marker.relative}\n`);
}

function listMarkers(root, directoryPath) {
  const directory = safeDirectory(root, directoryPath, 'marker directory');
  if (!existsSync(directory.absolute)) return { markers: [], checksums: [] };
  const info = lstatSync(directory.absolute);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('marker directory must be a real directory');
  const markers = [];
  const checksums = [];
  const visit = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('marker directory contains a symbolic link');
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.done')) markers.push(relative(root, absolute).split(sep).join('/'));
      else if (entry.isFile() && entry.name.endsWith('.done.sha256')) checksums.push(relative(root, absolute).split(sep).join('/'));
    }
  };
  visit(directory.absolute);
  return { markers, checksums };
}

function verifyAll(root, directory) {
  const { markers, checksums } = listMarkers(root, directory);
  const markerSet = new Set(markers.map(marker => `${marker}.sha256`));
  const orphan = checksums.find(checksum => !markerSet.has(checksum));
  let skipped = 0;
  let runs = 0;
  let failed = 0;
  if (orphan) {
    process.stdout.write(`FAIL orphan checksum ${orphan}\n`);
    failed += 1;
  }
  for (const marker of markers) {
    try {
      const result = checkMarker(root, marker);
      if (result.state === 'SKIP') skipped += 1;
      else runs += 1;
      process.stdout.write(`${result.state} ${result.stepId ?? result.marker}\n`);
    } catch (error) {
      failed += 1;
      process.stdout.write(`FAIL ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  process.stdout.write(`marker-check: ${skipped} skipped, ${runs} run, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const parsed = parseArgs(args);
  const root = rootFrom(parsed.root);
  if (command === 'write') writeMarker(root, parsed);
  else if (command === 'check') {
    if (!parsed.marker) throw new Error('check requires --marker');
    if (!parsed.marker.endsWith('.done')) throw new Error('marker path must end in .done');
    const result = checkMarker(root, parsed.marker);
    process.stdout.write(`${result.state} ${result.stepId ?? result.marker}\n`);
  } else if (command === 'verify-all') verifyAll(root, parsed.directory);
  else throw new Error('command must be write, check, or verify-all');
}

try {
  main();
} catch (error) {
  process.stdout.write(`FAIL ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
