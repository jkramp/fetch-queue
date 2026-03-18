export default [
    {
        files: ['**/*.js'],
        ignores: ['node_modules/**', 'coverage/**'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
        },
        rules: {
            'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        },
    },
]
