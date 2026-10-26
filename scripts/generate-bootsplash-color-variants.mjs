import fs from 'node:fs';
import path from 'node:path';

// The app logo is the single source of truth for splash artwork. Keep every
// density and launcher-color splash variant branded consistently.
const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
const projectRoot = process.cwd();
const sourcePath = path.join(projectRoot, 'assets', 'aplogo.png');
const logo = fs.readFileSync(sourcePath);

for (const density of densities) {
  const filename = path.join(
    projectRoot,
    'assets',
    'bootsplash',
    'android',
    `drawable-${density}`,
    'bootsplash_logo.png',
  );
  fs.writeFileSync(filename, logo);

  for (const name of ['white', 'tomato', 'gray', 'blue', 'lavender']) {
    const variantFilename = `bootsplash_logo_${name}.png`;
    fs.writeFileSync(path.join(path.dirname(filename), variantFilename), logo);
    const nativeFilename = path.join(
      projectRoot,
      'android',
      'app',
      'src',
      'main',
      'res',
      `drawable-${density}`,
      variantFilename,
    );
    if (fs.existsSync(path.dirname(nativeFilename))) {
      fs.writeFileSync(nativeFilename, logo);
    }
  }
}
