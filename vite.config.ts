import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import { realmBrewPlugin } from './src/server/vitePlugin';
import { overlayPrototypePlugin } from './src/prototype/overlayPrototypeServer';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const bundleDir = env.REALM_BREW_BUNDLE_DIR || process.env.REALM_BREW_BUNDLE_DIR;

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(command === 'serve' ? [overlayPrototypePlugin({ bundleDir })] : []),
      realmBrewPlugin({
        bundleDir,
        dataDir: path.resolve(process.cwd(), '.data'),
      }),
    ],
  };
});
