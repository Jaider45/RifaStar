import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Public } from '../../auth/decorators';
import { AppError } from '../../common/errors';
import { RateLimit } from '../../rate-limit/rate-limit';

const pair = (() => {
  let cached: { publicKey: string; privateKey: string } | undefined;
  return () =>
    (cached ??= generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    }));
})();

const Card = z.object({
  number: z.string().regex(/^\d{12,19}$/),
  cvc: z.string().regex(/^\d{3,4}$/),
  exp_month: z.string().regex(/^\d{2}$/),
  exp_year: z.string().regex(/^\d{2}$/),
  card_holder: z.string().min(2),
});

const luhn = (n: string) => [...n].reverse().reduce((s, c, i) => s + (i % 2 ? (Number(c) * 2 > 9 ? Number(c) * 2 - 9 : Number(c) * 2) : Number(c)), 0) % 10 === 0;

/** Descifra un JWE compacto RSA-OAEP-256 + A256GCM, como lo haría Wompi con su llave privada. */
export function decryptCardJwe(jwe: string): z.infer<typeof Card> {
  const [header, encryptedKey, iv, ciphertext, tag] = jwe.split('.');
  if (!header || !encryptedKey || !iv || !ciphertext || !tag) throw new Error('JWE mal formado');
  const parsed = JSON.parse(Buffer.from(header, 'base64url').toString()) as { alg?: string; enc?: string };
  if (parsed.alg !== 'RSA-OAEP-256' || parsed.enc !== 'A256GCM') throw new Error('Algoritmo no soportado');
  const cek = privateDecrypt({ key: pair().privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(encryptedKey, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', cek, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(header));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const plain = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString();
  return Card.parse(JSON.parse(plain));
}

/**
 * Tokenización de tarjetas simulada para desarrollo, pruebas y la demo (WOMPI_DRIVER=fake). Imita
 * los dos endpoints de Wompi que usa el navegador. SOLO se registra con el driver simulado, que en
 * producción nunca se activa. El token termina en los últimos 4 dígitos para que el Wompi simulado
 * apruebe la 4242… y rechace la 4111….
 */
@ApiTags('Simulación (solo desarrollo)')
@Public()
@Controller('dev/wompi')
export class SimulatedWompiController {
  @Get('tokens/keys/tokenization')
  @ApiExcludeEndpoint()
  @RateLimit({ name: 'sim-wompi-key', by: ['ip'], limit: 120, windowSeconds: 60 })
  key() {
    return { data: { publicKey: pair().publicKey } };
  }

  @Post('tokens/cards')
  @HttpCode(201)
  @ApiExcludeEndpoint()
  @RateLimit({ name: 'sim-wompi-card', by: ['ip'], limit: 60, windowSeconds: 60 })
  card(@Body() body: { payload?: string }) {
    let card: z.infer<typeof Card>;
    try {
      card = decryptCardJwe(String(body?.payload ?? ''));
    } catch {
      throw new AppError('SIMULATED_WOMPI_422', 422, 'Datos de tarjeta inválidos.');
    }
    if (!luhn(card.number)) throw new AppError('SIMULATED_WOMPI_422', 422, 'Número de tarjeta inválido.');
    return { status: 'CREATED', data: { id: `tok_sim_${randomBytes(6).toString('hex')}_${card.number.slice(-4)}`, last_four: card.number.slice(-4), exp_month: card.exp_month, exp_year: card.exp_year, card_holder: card.card_holder } };
  }
}
