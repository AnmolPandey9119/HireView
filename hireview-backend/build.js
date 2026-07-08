// ════════════════════════════════════════════════
// Build script — runs on Vercel before deploy.
// Reads BACKEND_URL and ADMIN_SLUG from the environment (set in
// the Vercel dashboard, never committed to git) and:
//   1. writes the real js/config.js from js/config.template.js
//   2. renames the generic admin-template/ folder to the real,
//      private admin URL slug — so the actual admin path never
//      appears anywhere in git history or a public repo.
// ════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const backendUrl = process.env.BACKEND_URL;
const adminSlug = process.env.ADMIN_SLUG;

if (!backendUrl) {
  console.error('ERROR: BACKEND_URL environment variable is not set.');
  console.error('Set it in your Vercel project → Settings → Environment Variables.');
  process.exit(1);
}

if (!adminSlug) {
  console.error('ERROR: ADMIN_SLUG environment variable is not set.');
  console.error('Set it in Vercel → Settings → Environment Variables to a private, random');
  console.error('folder name, e.g. admin-9f2a7c1e5d3b8046 (generate one with:');
  console.error('  node -e "console.log(\'admin-\' + require(\'crypto\').randomBytes(8).toString(\'hex\'))"');
  console.error(')');
  process.exit(1);
}

// ---------- 1. Inject BACKEND_URL into js/config.js ----------
const templatePath = path.join(__dirname, 'js', 'config.template.js');
const outputPath = path.join(__dirname, 'js', 'config.js');

const template = fs.readFileSync(templatePath, 'utf8');
const output = template.replaceAll('__BACKEND_URL__', backendUrl);

fs.writeFileSync(outputPath, output, 'utf8');
console.log(`Generated js/config.js with BACKEND_URL=${backendUrl}`);

// ---------- 2. Rename admin-template/ -> the real private slug ----------
const templateDir = path.join(__dirname, 'admin-template');
const realDir = path.join(__dirname, adminSlug);

if (fs.existsSync(templateDir)) {
  fs.renameSync(templateDir, realDir);
  console.log(`Renamed admin-template/ -> ${adminSlug}/`);
} else if (fs.existsSync(realDir)) {
  console.log(`${adminSlug}/ already exists, nothing to rename.`);
} else {
  console.error('ERROR: Could not find admin-template/ folder to rename.');
  process.exit(1);
}
