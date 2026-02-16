#!/usr/bin/env node
/**
 * Generate extension icons from a single source image.
 *
 * Preferred source:
 *   icons/logo-source.png
 *
 * Fallback source:
 *   icons/icon.svg
 *
 * Output:
 *   icon16.png, icon32.png, icon48.png, icon128.png
 */

import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SIZES = [16, 32, 48, 128];
const PNG_SOURCE = join(__dirname, 'logo-source.png');
const SVG_SOURCE = join(__dirname, 'icon.svg');
const CROP_RATIO = 0.87;

function resolveSource() {
  if (existsSync(PNG_SOURCE)) return PNG_SOURCE;
  if (existsSync(SVG_SOURCE)) return SVG_SOURCE;
  return null;
}

function readImageSize(path) {
  const output = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path], {
    encoding: 'utf8'
  });
  const widthMatch = output.match(/pixelWidth:\s*(\d+)/);
  const heightMatch = output.match(/pixelHeight:\s*(\d+)/);
  const width = Number(widthMatch?.[1] || 0);
  const height = Number(heightMatch?.[1] || 0);
  if (!width || !height) {
    throw new Error(`Unable to read image dimensions for ${path}`);
  }
  return { width, height };
}

function cropCenter(path) {
  const { width, height } = readImageSize(path);
  const side = Math.floor(Math.min(width, height) * CROP_RATIO);
  const output = join(__dirname, '.logo-cropped.tmp.png');

  execFileSync('sips', ['-c', String(side), String(side), path, '--out', output], {
    stdio: 'ignore'
  });
  return output;
}

async function generate() {
  const source = resolveSource();
  if (!source) {
    throw new Error('No icon source found. Add icons/logo-source.png (recommended).');
  }

  console.log(`Using source: ${source}`);
  const cropped = cropCenter(source);
  console.log(`Using center-cropped source for icon legibility: ${cropped}`);

  for (const size of SIZES) {
    const output = join(__dirname, `icon${size}.png`);
    execFileSync('sips', ['-z', String(size), String(size), cropped, '--out', output], {
      stdio: 'ignore'
    });
    console.log(`✓ Generated ${output}`);
  }

  execFileSync('rm', ['-f', cropped], { stdio: 'ignore' });
}

generate()
  .then(() => {
    console.log('\n✅ Icon generation complete');
  })
  .catch((error) => {
    console.error(`\n❌ Icon generation failed: ${error.message}`);
    console.error("Make sure 'sips' is available (macOS) and source image exists.");
    process.exit(1);
  });
