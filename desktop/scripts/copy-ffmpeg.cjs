const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const destDir = path.join(__dirname, '..', 'public', 'ffmpeg');

try {
  // Ensure destination directory exists (equivalent to mkdir -p)
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Files to copy
  const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

  files.forEach(file => {
    const srcFile = path.join(srcDir, file);
    const destFile = path.join(destDir, file);
    
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, destFile);
      console.log(`✓ Copied ${file} to public/ffmpeg/`);
    } else {
      console.error(`❌ Error: Source file ${srcFile} not found in node_modules!`);
      process.exit(1);
    }
  });
} catch (err) {
  console.error('❌ Failed to copy FFmpeg files:', err.message);
  process.exit(1);
}
