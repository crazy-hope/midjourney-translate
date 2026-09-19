'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const errors = [];

if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');

const declared = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...(manifest.content_scripts || []).flatMap((entry) => [...(entry.js || []), ...(entry.css || [])]),
].filter(Boolean);

for (const relativePath of declared) {
  if (/^https?:\/\//i.test(relativePath)) {
    errors.push(`remote entry point is forbidden: ${relativePath}`);
    continue;
  }
  if (!fs.existsSync(path.join(root, relativePath))) {
    errors.push(`missing declared file: ${relativePath}`);
  }
}

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(absolute);
      continue;
    }
    if (!/\.(?:html|js)$/i.test(entry.name)) continue;
    const source = fs.readFileSync(absolute, 'utf8');
    if (/<script\b[^>]*\bsrc=["']https?:\/\//i.test(source)) {
      errors.push(`remote script is forbidden: ${path.relative(root, absolute)}`);
    }
    if (/importScripts\s*\(\s*["']https?:\/\//i.test(source)) {
      errors.push(`remote importScripts is forbidden: ${path.relative(root, absolute)}`);
    }
  }
}

visit(root);

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Manifest V3 validation passed; all declared files exist; no remote scripts found.');
}
