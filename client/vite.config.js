import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// npm run dev    -> http://localhost:5173            (laptop only)
// npm run phone  -> https://<laptop-wifi-ip>:5173    (phones on the same Wi-Fi; camera works because it's https)
// npm run build:demo -> demo website for GitHub Pages (no server needed)
export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE || '/',
  plugins: [react(), ...(mode === 'phone' ? [basicSsl()] : [])],
  server: {
    host: true, // reachable from phones on the same Wi-Fi
    port: 5173,
    allowedHosts: true, // also allows https tunnels (cloudflared / ngrok)
    proxy: { '/api': 'http://localhost:4000' },
  },
  build: {
    rollupOptions: {
      output: {
        // keep the big AWS liveness code in its own file; only loaded when liveness is used
        manualChunks: (id) => (id.includes('aws-amplify') || id.includes('@aws-amplify') ? 'liveness' : undefined),
      },
    },
  },
}));
