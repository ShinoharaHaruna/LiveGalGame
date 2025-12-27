import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';

// Windows: `chcp 65001` ensures UTF-8 console output (especially for Electron logs).
// macOS/Linux: `chcp` doesn't exist, so we skip it.
const command = isWindows
  ? 'chcp 65001 > nul && pnpm run predev && concurrently -k "vite" "npm run dev:electron"'
  : 'pnpm run predev && concurrently -k "vite" "npm run dev:electron"';

const child = spawn(command, {
  stdio: 'inherit',
  shell: true
});

child.on('error', (err) => {
  console.error('[dev] Failed to start:', err);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (typeof code === 'number') {
    process.exit(code);
  }
  if (signal) {
    // Match common shell behavior: 128 + signal number is typical, but Node doesn't always map it.
    // Exiting with 1 is fine for our dev runner.
    console.error(`[dev] Exited due to signal: ${signal}`);
  }
  process.exit(1);
});
