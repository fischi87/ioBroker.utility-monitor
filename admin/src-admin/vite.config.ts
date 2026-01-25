import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        federation({
            name: 'UtilityMonitor',
            filename: 'CSVImporter_v15_11.js', // Cache buster
            exposes: {
                './Components': './src/Components.tsx',
            },
            shared: {
                react: {
                    singleton: true,
                },
                'react-dom': {
                    singleton: true,
                },
            },
            manifest: true,
        }),
    ],
    build: {
        target: 'esnext',
        minify: false,
        cssCodeSplit: false,
        outDir: '../custom',
        emptyOutDir: true,
    },
});
