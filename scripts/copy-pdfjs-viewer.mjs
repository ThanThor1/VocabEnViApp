import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const srcDir = path.join(rootDir, 'node_modules', 'pdfjs-dist', 'web');
const destDir = path.join(rootDir, 'public', 'pdfjs', 'web');

// Recursively copy directory
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const files = fs.readdirSync(src);
  files.forEach(file => {
    const srcFile = path.join(src, file);
    const destFile = path.join(dest, file);
    const stat = fs.statSync(srcFile);
    
    if (stat.isDirectory()) {
      copyDir(srcFile, destFile);
    } else {
      fs.copyFileSync(srcFile, destFile);
    }
  });
}

try {
  console.log(`Copying PDF.js viewer from ${srcDir} to ${destDir}`);
  copyDir(srcDir, destDir);
  console.log('✓ PDF.js viewer copied successfully');
} catch (err) {
  console.error('✗ Error copying PDF.js viewer:', err);
  process.exit(1);
}
