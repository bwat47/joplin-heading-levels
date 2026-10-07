import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            api: resolve(import.meta.dirname, 'api'),
        },
    },
    test: {
        environment: 'node',
        globals: true,
        passWithNoTests: true,
    },
});
