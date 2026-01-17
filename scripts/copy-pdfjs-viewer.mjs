import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const srcDir = path.join(rootDir, 'node_modules', 'pdfjs-dist', 'web');
const destDir = path.join(rootDir, 'public', 'pdfjs', 'web');

const srcBuildDir = path.join(rootDir, 'node_modules', 'pdfjs-dist', 'build');
const destBuildDir = path.join(rootDir, 'public', 'pdfjs', 'build');

// Recursively copy directory
function copyDir(src, dest, opts = {}) {
  const { skip = new Set() } = opts;
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const files = fs.readdirSync(src);
  files.forEach(file => {
    if (skip && skip.has(file)) return;
    const srcFile = path.join(src, file);
    const destFile = path.join(dest, file);
    const stat = fs.statSync(srcFile);
    
    if (stat.isDirectory()) {
      copyDir(srcFile, destFile, opts);
    } else {
      fs.copyFileSync(srcFile, destFile);
    }
  });
}

try {
  console.log(`Copying PDF.js viewer from ${srcDir} to ${destDir}`);
  // This repo customizes public/pdfjs/web/viewer.html; don't overwrite it during install.
  const skipWeb = new Set(['viewer.html']);
  copyDir(srcDir, destDir, { skip: skipWeb });
  console.log('✓ PDF.js viewer copied successfully');

  console.log(`Copying PDF.js build from ${srcBuildDir} to ${destBuildDir}`);
  copyDir(srcBuildDir, destBuildDir);
  console.log('✓ PDF.js build copied successfully');
} catch (err) {
  console.error('✗ Error copying PDF.js viewer:', err);
  process.exit(1);
}
