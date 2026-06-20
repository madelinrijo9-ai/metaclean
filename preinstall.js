const fs = require('fs');

// Remove lockfiles if they exist
try {
  if (fs.existsSync('package-lock.json')) {
    fs.unlinkSync('package-lock.json');
  }
  if (fs.existsSync('yarn.lock')) {
    fs.unlinkSync('yarn.lock');
  }
} catch (err) {
  console.warn('Warning: Could not remove lockfiles:', err.message);
}

// Ensure pnpm is used
const userAgent = process.env.npm_config_user_agent || '';
if (!userAgent.startsWith('pnpm/')) {
  console.error('\x1b[31m%s\x1b[0m', '=========================================');
  console.error('\x1b[31m%s\x1b[0m', '❌ Error: Please use pnpm for installation.');
  console.error('\x1b[31m%s\x1b[0m', 'Run "npx pnpm install" instead of npm/yarn.');
  console.error('\x1b[31m%s\x1b[0m', '=========================================');
  process.exit(1);
}
