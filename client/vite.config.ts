import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

// Self-signed certs in /certs enable HTTPS, which browsers require for
// disk-streaming downloads (File System Access API) on non-localhost origins.
const certDir = path.resolve(__dirname, '../certs');
const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');
const hasCerts = fs.existsSync(keyPath) && fs.existsSync(certPath);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    host: true, // listen on all interfaces so LAN devices can reach the app
    port: 5173,
    https: hasCerts ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) } : undefined,
    fs: {
      // allow importing ../shared from outside the client root
      allow: [path.resolve(__dirname, '..')],
    },
  },
});
