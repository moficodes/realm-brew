import path from 'node:path';
import type { Plugin } from 'vite';
import { createApiHandler } from './middleware';

export interface RealmBrewPluginOptions {
  bundleDir?: string;
  dataDir?: string;
}

export function realmBrewPlugin(options: RealmBrewPluginOptions = {}): Plugin {
  const dataDir = options.dataDir ?? path.resolve(process.cwd(), '.data');
  const handler = createApiHandler({
    bundleDir: options.bundleDir,
    dataDir,
  });

  return {
    name: 'realm-brew-local-api',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
