import retail from './packages/config/eslint.mjs';

export default [
  { ignores: ['legacy/**', '**/dist/**', '**/.turbo/**', '**/coverage/**', '**/.next/**', '**/next-env.d.ts'] },
  ...retail,
];
