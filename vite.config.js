import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.dirname(fileURLToPath(import.meta.url));
const SERVEUR = 'http://localhost:3000';

export default defineConfig({
  root: path.join(racine, 'client'),
  base: './',
  // Les assets (modèles, textures, HDRI, sons) sont servis à la racine du site :
  // client/assets/models/cars/comete.glb  ->  /models/cars/comete.glb
  publicDir: path.join(racine, 'client/assets'),
  resolve: {
    alias: {
      '@shared': path.join(racine, 'shared'),
      '@': path.join(racine, 'client/src')
    }
  },
  build: {
    outDir: path.join(racine, 'dist'),
    emptyOutDir: true,
    target: 'es2022'
  },
  server: {
    port: 5173,
    strictPort: false,
    // Autorise Vite à lire /shared, qui est en dehors de la racine client/
    fs: { allow: [racine] },
    proxy: {
      '/api': SERVEUR,
      '/health': SERVEUR,
      '/circuits': SERVEUR,
      '/admin': SERVEUR,
      '/socket.io': { target: SERVEUR, ws: true }
    }
  }
});
