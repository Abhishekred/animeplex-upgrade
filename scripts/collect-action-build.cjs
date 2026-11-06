const fs = require('node:fs');
const path = require('node:path');

const [kind, destination] = process.argv.slice(2);
if (!['apk', 'aab'].includes(kind) || !destination) throw new Error('Usage: collect-action-build.cjs apk|aab destination');
if (kind !== 'apk') throw new Error('Only unsigned Android phone APK builds are supported by this workflow');
const expectedPackage = 'com.vega';
const gradle = fs.readFileSync('android/app/build.gradle', 'utf8');
const packageMatch = gradle.match(/^\s*applicationId\s*(?:=\s*)?(["'])([^"']+)\1\s*;?\s*$/m);
if (packageMatch?.[2] !== expectedPackage) {
  throw new Error(`Wrong package: expected ${expectedPackage}, found ${packageMatch?.[2] || 'no applicationId'}`);
}
const folder = 'android/app/build/outputs/apk/release';
const files = fs.readdirSync(folder).filter(name => name.endsWith('.apk') && name.includes('unsigned'));
// The release plugin builds one universal ARM APK; fail instead of choosing an ABI at random.
if (files.length !== 1) throw new Error(`Expected one unsigned phone APK, found ${files.length}`);
fs.copyFileSync(path.join(folder, files[0]), destination);
fs.writeFileSync(path.join(path.dirname(destination), 'apk-name.txt'), files[0]);
console.log(`Prepared ${path.basename(destination)}`);
