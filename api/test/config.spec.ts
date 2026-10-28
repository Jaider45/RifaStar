import { type Env, env, productionProblems } from '../src/config/env';

describe('Configuración de producción', () => {
  /** Configuración real de producción (valores inventados, con la forma correcta). */
  const prod = (): Env => ({
    ...env(),
    NODE_ENV: 'production',
    COOKIE_SECURE: true,
    PUBLIC_BASE_URL: 'https://rifastar.co',
    CORS_ORIGINS: 'https://rifastar.co',
    JWT_ACCESS_SECRET: 'f'.repeat(48),
    JWT_PARTICIPANT_SECRET: 'e'.repeat(48),
    HASH_PEPPER: 'p'.repeat(32),
    ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    STORAGE_DRIVER: 's3',
    S3_ENDPOINT: 'https://cuenta.r2.cloudflarestorage.com',
    S3_ACCESS_KEY: 'clave',
    S3_SECRET_KEY: 'secreto',
    MAIL_DRIVER: 'smtp',
    SMTP_URL: 'smtps://usuario:clave@smtp.proveedor.com:465',
    MESSAGING_DRIVER: 'meta',
    WHATSAPP_PHONE_NUMBER_ID: '123',
    WHATSAPP_ACCESS_TOKEN: 'token',
    WHATSAPP_APP_SECRET: 'secreto',
    WHATSAPP_VERIFY_TOKEN: 'verificar',
  });

  it('una configuración completa pasa; en desarrollo no se exige nada', () => {
    expect(productionProblems(prod())).toEqual([]);
    expect(productionProblems({ ...prod(), NODE_ENV: 'development', MESSAGING_DRIVER: 'fake', COOKIE_SECURE: false })).toEqual([]);
  });

  it('no arranca con proveedores simulados, secretos de ejemplo ni direcciones locales', () => {
    const problems = productionProblems({
      ...prod(),
      COOKIE_SECURE: false,
      PUBLIC_BASE_URL: 'http://localhost:5173',
      JWT_ACCESS_SECRET: 'dev-access-secret-cambia-esto-en-produccion',
      ENCRYPTION_KEY: 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=',
      MESSAGING_DRIVER: 'fake',
      STORAGE_DRIVER: 'fake',
      SMTP_URL: 'smtp://mailpit:1025',
      LOTTERY_DRIVER: 'loteriaya',
      LOTERIAYA_API_KEY: '',
    });
    expect(problems.map((p) => p.split(' ')[0])).toEqual([
      'COOKIE_SECURE',
      'PUBLIC_BASE_URL',
      'CORS_ORIGINS',
      'JWT_ACCESS_SECRET',
      'ENCRYPTION_KEY',
      'El',
      'MAIL_DRIVER=smtp',
      'MESSAGING_DRIVER=meta',
      'LOTTERY_DRIVER=loteriaya',
    ]);
  });
});
