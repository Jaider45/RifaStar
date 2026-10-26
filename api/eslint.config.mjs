import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // NestJS necesita los imports reales de las clases inyectadas (emitDecoratorMetadata).
      '@typescript-eslint/consistent-type-imports': 'off',
      'no-restricted-imports': 'off',
    },
  },
  {
    // El cliente de sistema (salta RLS) solo se usa donde está justificado.
    files: ['src/**/*.ts'],
    ignores: [
      'src/database/**',
      'src/platform/**',
      'src/auth/**',
      'src/tenancy/**',
      'src/jobs/**',
      'src/billing/**',
      'src/messaging/**',
      'src/audit/**',
      'src/public/**',
      'src/permissions/**',
      'src/health.controller.ts',
      'src/plans/**',
      // Resultados de loterías: tabla global (sin organización) y búsqueda de sorteos de todas las orgs.
      'src/lottery/**',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "MemberExpression[property.name='system']", message: 'Usa tenantTx(): el cliente de sistema salta RLS.' },
      ],
    },
  },
);
