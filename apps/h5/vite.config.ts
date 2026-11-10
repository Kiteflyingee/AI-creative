import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // 共用一份 React 与 Remotion（Remotion 要求单一实例）
    dedupe: ['react', 'react-dom', 'remotion'],
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
});
