#!/usr/bin/env node
/**
 * Build script for WebMCP Inspector.
 * Creates a complete loadable extension package in dist/.
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'popup.js',
  'sidebar.html',
  'sidebar.js',
  'styles.css',
  'package.json'
];

const DIRECTORIES = ['icons', 'js'];

function ensureDir(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function copyFile(file) {
  cpSync(file, join('dist', file), { force: true });
  console.log(`✓ Copied ${file}`);
}

function copyDirectory(dir) {
  cpSync(dir, join('dist', dir), { recursive: true, force: true });
  console.log(`✓ Copied ${dir}/`);
}

function build() {
  console.log('🔨 Building WebMCP Inspector...\n');

  if (existsSync('dist')) {
    rmSync('dist', { recursive: true, force: true });
    console.log('✓ Cleaned dist/');
  }

  ensureDir('dist');

  for (const file of FILES) {
    if (!existsSync(file)) {
      console.warn(`⚠ Skipped missing file: ${file}`);
      continue;
    }
    copyFile(file);
  }

  for (const dir of DIRECTORIES) {
    if (!existsSync(dir)) {
      console.warn(`⚠ Skipped missing directory: ${dir}/`);
      continue;
    }
    copyDirectory(dir);
  }

  console.log('\n✅ Build complete!');
  console.log('Load dist/ as an unpacked extension in chrome://extensions/.');
}

build();
