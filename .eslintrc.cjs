// Flat ESLint config is still in transition; using classic .eslintrc for broad tool support.
// JSX-only project. TypeScript is strictly banned (see requirements §97).

module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2023: true,
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  settings: {
    react: { version: 'detect' },
    'import/resolver': {
      node: { extensions: ['.js', '.jsx', '.cjs', '.mjs'] },
    },
  },
  plugins: ['react', 'react-hooks', 'jsx-a11y', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
    'plugin:jsx-a11y/recommended',
    'plugin:import/recommended',
    'prettier',
  ],
  rules: {
    'react/prop-types': 'warn',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    eqeqeq: ['error', 'smart'],
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    'import/order': [
      'warn',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
    'import/no-unresolved': 'off',
  },
  ignorePatterns: [
    'dist',
    'dist-electron',
    'build',
    'coverage',
    'release',
    'node_modules',
    '**/*.min.js',
  ],
  overrides: [
    {
      files: ['**/*.cjs'],
      env: { node: true, browser: false },
    },
    {
      files: ['**/electron/**/*.{js,cjs,mjs}'],
      env: { node: true, browser: false },
    },
  ],
};
