import eslintParser from '@babel/eslint-parser';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/generated/**',
      '**/coverage/**',
      '**/.vite/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: eslintParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        requireConfigFile: false,
        babelOptions: {
          plugins: [
            ['@babel/plugin-syntax-decorators', { version: 'legacy' }],
            ['@babel/plugin-syntax-typescript', { isTSX: true }],
            '@babel/plugin-syntax-jsx',
          ],
        },
      },
    },
    rules: {
      'no-constant-condition': 'error',
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',
      'no-unreachable': 'error',
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    rules: {
      'no-constant-condition': 'error',
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',
      'no-unreachable': 'error',
      'no-unused-vars': 'error',
    },
  },
];
