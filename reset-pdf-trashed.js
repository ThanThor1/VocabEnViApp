/**
 * Reset all PDFs trashed flag to false
 * Run: node reset-pdf-trashed.js
 */
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const app = require('electron').app;

const getDataPdfRoot = () => {
  const root = path.join(process.env.APPDATA || '/tmp', 'AppName/Data/pdf');
  return root;
};

(async () => {
  try {
    const pdfRoot = getDataPdfRoot();
    console.log('PDF Root:', pdfRoot);

    if (!fsSync.existsSync(pdfRoot)) {
      console.log('PDF root does not exist');
      process.exit(0);
    }

    const items = await fs.readdir(pdfRoot, { withFileTypes: true });
    for (const item of items) {
      if (!item.isDirectory()) continue;
      const metaPath = path.join(pdfRoot, item.name, 'meta.json');
      if (fsSync.existsSync(metaPath)) {
        const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
        meta.trashed = false;
        await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
        console.log(`Reset ${item.name} to trashed: false`);
      }
    }
    console.log('Done!');
  } catch (err) {
    console.error('Error:', err);
  }
})();
