import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        port: 3001,
        open: true,
        proxy: {
            '/api/s3-proxy': {
                target: 'https://clarity-davion-attachment.s3.us-west-2.amazonaws.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/s3-proxy/, ''),
                configure: (proxy, _options) => {
                    proxy.on('proxyReq', (proxyReq, req, _res) => {
                        // Remove referer to avoid CORS issues
                        proxyReq.removeHeader('referer');
                    });
                }
            },
            '/components/sensor-graph-linechart': {
                target: 'https://storage.googleapis.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/components\/sensor-graph-linechart/, '/erg-static-files/sensor-graph-linechart'),
                configure: (proxy, _options) => {
                    proxy.on('proxyReq', (proxyReq, req, _res) => {
                        proxyReq.removeHeader('referer');
                    });
                }
            },
            '/r-api': {
                target: 'http://localhost:8000',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/r-api/, '')
            }
        }
    },
    build: {
        outDir: 'dist',
        sourcemap: true
    }
});
