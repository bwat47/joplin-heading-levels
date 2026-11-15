import { defineConfig } from 'oxlint';

export default defineConfig({
    plugins: ['typescript', 'import', 'vitest', 'unicorn', 'oxc'],
    categories: {
        correctness: 'error',
        suspicious: 'error',
    },
    options: {
        typeAware: true,
    },
    env: {
        node: true,
    },
    ignorePatterns: ['api/**', '.api-staging-*/**', 'dist/**'],
    rules: {
        eqeqeq: ['error', 'always'],
        'typescript/no-unsafe-type-assertion': 'off',
        'import/no-cycle': 'error',
        'import/no-duplicates': ['error', { preferInline: true }],
        // toSorted()/toReversed() are ES2023; the build targets ES2020.
        'unicorn/no-array-sort': 'off',
        'unicorn/no-array-reverse': 'off',
        'typescript/no-explicit-any': 'error',
        'typescript/explicit-module-boundary-types': 'error',
        'typescript/no-inferrable-types': 'error',
        'typescript/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
        'typescript/no-import-type-side-effects': 'error',
        'typescript/consistent-type-exports': ['error', { fixMixedExportsWithInlineTypeSpecifier: true }],
        'typescript/no-unnecessary-condition': 'error',
        'typescript/no-misused-promises': 'error',
        'typescript/no-unsafe-assignment': 'error',
        'typescript/no-unsafe-call': 'error',
        'typescript/no-unsafe-member-access': 'error',
        'typescript/no-unsafe-return': 'error',
        'typescript/no-unsafe-argument': 'error',
        'typescript/require-await': 'error',
        'typescript/no-unnecessary-type-assertion': 'error',
    },
    overrides: [
        {
            files: ['src/**/*.test.ts'],
            env: {
                vitest: true,
            },
            rules: {
                'typescript/unbound-method': 'off',
            },
        },
    ],
});
