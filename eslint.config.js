import js from '@eslint/js'
import globals from 'globals'

export default [
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: { globals: globals.node },
        rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
    },
    {
        files: ['index.js'],
        languageOptions: { globals: globals.browser },
        rules: { 'no-console': ['error', { allow: ['debug'] }] },
    },
]
