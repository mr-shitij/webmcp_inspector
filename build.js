#!/usr/bin/env node
/**
 * Build script for WebMCP Inspector.
 * Creates a complete loadable extension package in dist/.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(PROJECT_ROOT, 'dist');

const FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'popup.js',
  'sidebar.html',
  'sidebar.js',
  'styles.css',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'js/index.js',
  'js/settings/SettingsManager.js',
  'js/ai/AIManager.js',
  'js/ai/AIProvider.js',
  'js/ai/utils/toolSchemas.js',
  'js/ai/providers/OpenAIProvider.js',
  'js/ai/providers/AnthropicProvider.js',
  'js/ai/providers/GeminiProvider.js',
  'js/ai/providers/OllamaProvider.js'
];

function ensureDir(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function copyFile(file) {
  const source = join(PROJECT_ROOT, file);
  const destination = join(OUTPUT_DIR, file);
  ensureDir(dirname(destination));
  copyFileSync(source, destination);
  console.log(`✓ Copied ${file}`);
}

function build() {
  console.log('🔨 Building WebMCP Inspector...\n');

  const manifest = JSON.parse(readFileSync(join(PROJECT_ROOT, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3) throw new Error('Only Manifest V3 builds are supported.');

  if (existsSync(OUTPUT_DIR)) {
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
    console.log('✓ Cleaned dist/');
  }

  ensureDir(OUTPUT_DIR);

  for (const file of FILES) {
    if (!existsSync(join(PROJECT_ROOT, file))) throw new Error(`Required build file is missing: ${file}`);
    copyFile(file);
  }

  console.log('\n✅ Build complete!');
  console.log('Load dist/ as an unpacked extension in chrome://extensions/.');
}

build();
