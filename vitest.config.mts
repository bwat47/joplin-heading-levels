import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        tsconfigPaths: true,
    },
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
        globals: true,
        passWithNoTests: true,
    },
});
