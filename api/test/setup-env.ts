/** Variables para los tests: base `rifastar_test` y Redis en la base 15. */
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://rifastar:rifastar@localhost:5432/rifastar_test',
  APP_DATABASE_URL: 'postgresql://rifastar_app:rifastar_app@localhost:5432/rifastar_test?connection_limit=60',
  SYSTEM_DATABASE_URL: 'postgresql://rifastar_system:rifastar_system@localhost:5432/rifastar_test?connection_limit=20',
  REDIS_URL: 'redis://localhost:6379/15',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789-abcdefghijkl',
  JWT_PARTICIPANT_SECRET: 'test-participant-secret-0123456789-abcdefg',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  HASH_PEPPER: 'test-pepper',
  COOKIE_SECURE: 'false',
  MAIL_DRIVER: 'fake',
  STORAGE_DRIVER: 'fake',
  MESSAGING_DRIVER: 'fake',
  BILLING_DRIVER: 'fake',
  PUBLIC_BASE_URL: 'http://localhost:5173',
  LOG_LEVEL: 'silent',
};

for (const [key, value] of Object.entries(defaults)) {
  if (process.env[`TEST_${key}`]) process.env[key] = process.env[`TEST_${key}`];
  else process.env[key] = value;
}
