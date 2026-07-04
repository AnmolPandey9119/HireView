// ════════════════════════════════════════════════
// Build script — runs on Vercel before deploy.
// Reads BACKEND_URL from the environment (set in the
// Vercel dashboard, not committed to git) and writes
// the real js/config.js from js/config.template.js.
// ════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const backendUrl = process.env.BACKEND_URL;

if (!backendUrl) {
  console.error('ERROR: BACKEND_URL environment variable is not set.');
  console.error('Set it in your Vercel project → Settings → Environment Variables.');
  process.exit(1);
}

const templatePath = path.join(__dirname, 'js', 'config.template.js');
const outputPath = path.join(__dirname, 'js', 'config.js');

const template = fs.readFileSync(templatePath, 'utf8');
const output = template.replaceAll('__BACKEND_URL__', backendUrl);

fs.writeFileSync(outputPath, output, 'utf8');
console.log(`Generated js/config.js with BACKEND_URL=${backendUrl}`);