import { BOYACA_PRIZES, createRaffle, EXE, PNG, storage } from './fixtures';
import { as, closeTestApp, createOrg, createTestApp, type TestContext, type TestOrg } from './helpers';

describe('Personalización de la página pública (punto 3)', () => {
  let ctx: TestContext;
  let t: TestOrg;

  beforeAll(async () => {
    ctx = await createTestApp();
    t = await createOrg(ctx);
  });
  afterAll(() => closeTestApp(ctx));

  /** Sube y confirma una foto de la galería o de un premio. Devuelve su key. */
  async function upload(raffleId: string, kind: 'gallery' | 'prize', file = PNG) {
    const up = await ctx.http.post(`/v1/raffles/${raffleId}/media/${kind}`).set(as(t.ownerToken, t.org.id)).send({ contentType: 'image/png', size: file.length }).expect(201);
    storage(ctx).put(up.body.key, file);
    return ctx.http.post(`/v1/raffles/${raffleId}/media/${kind}/confirm`).set(as(t.ownerToken, t.org.id)).send({ key: up.body.key });
  }

  it('tema, descripción, preguntas y secciones visibles llegan a la página pública', async () => {
    const raffle = await createRaffle(ctx, t, {
      extra: {
        accentColor: '#1d4ed8',
        pageConfig: {
          theme: 'light',
          description: '**Moto 0 km** con papeles.',
          faq: [{ q: '¿Cuándo entregan?', a: 'Al día siguiente del sorteo.' }],
          show: { countdown: false, ranking: false },
        },
      },
    });
    const pub = await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}`).expect(200);
    expect(pub.body.raffle.accentColor).toBe('#1d4ed8');
    expect(pub.body.raffle.page).toEqual({
      theme: 'light',
      description: '**Moto 0 km** con papeles.',
      faq: [{ q: '¿Cuándo entregan?', a: 'Al día siguiente del sorteo.' }],
      show: { countdown: false, progress: true, remaining: true, organizer: true, ranking: false, social: true },
    });

    const bad = await ctx.http.patch(`/v1/raffles/${raffle.id}`).set(as(t.ownerToken, t.org.id)).send({ pageConfig: { theme: 'neón' } }).expect(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
    await ctx.http.patch(`/v1/raffles/${raffle.id}`).set(as(t.ownerToken, t.org.id)).send({ accentColor: 'rojo' }).expect(400);
  });

  it('galería: solo fotos verificadas de este sorteo', async () => {
    const raffle = await createRaffle(ctx, t);
    const ok = await upload(raffle.id, 'gallery');
    expect(ok.status).toBe(200);
    const bad = await upload(raffle.id, 'gallery', EXE);
    expect(bad.body.code).toBe('UPLOAD_INVALID_TYPE');

    // Una key inventada (o de otro sorteo) no se acepta.
    const forged = await ctx.http
      .patch(`/v1/raffles/${raffle.id}`)
      .set(as(t.ownerToken, t.org.id))
      .send({ galleryKeys: [ok.body.key, `gallery/${t.org.id}/otro-sorteo/x.png`] })
      .expect(400);
    expect(forged.body.message).toBe('El archivo no corresponde a esta solicitud.');
    // Con el prefijo correcto pero sin subir: tampoco.
    const missing = await ctx.http
      .patch(`/v1/raffles/${raffle.id}`)
      .set(as(t.ownerToken, t.org.id))
      .send({ galleryKeys: [`gallery/${t.org.id}/${raffle.id}/inventada.png`] })
      .expect(422);
    expect(missing.body.code).toBe('UPLOAD_NOT_FOUND');

    const saved = await ctx.http.patch(`/v1/raffles/${raffle.id}`).set(as(t.ownerToken, t.org.id)).send({ galleryKeys: [ok.body.key] }).expect(200);
    expect(saved.body.gallery).toHaveLength(1);
    const pub = await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}`).expect(200);
    expect(pub.body.raffle.gallery).toHaveLength(1);
  });

  it('la foto del premio se conserva al reemplazar la lista de premios', async () => {
    const raffle = await createRaffle(ctx, t);
    const photo = await upload(raffle.id, 'prize');
    const prizes = BOYACA_PRIZES.map((p, i) => (i === 0 ? { ...p, imageKey: photo.body.key } : p));
    const res = await ctx.http.put(`/v1/raffles/${raffle.id}/prizes`).set(as(t.ownerToken, t.org.id)).send({ prizes }).expect(200);
    expect(res.body.prizes[0]).toMatchObject({ imageKey: photo.body.key });
    expect(res.body.prizes[0].imageUrl).toContain('almacenamiento.local');
    const again = await ctx.http.put(`/v1/raffles/${raffle.id}/prizes`).set(as(t.ownerToken, t.org.id)).send({ prizes }).expect(200);
    expect(again.body.prizes[0].imageKey).toBe(photo.body.key);
  });

  it('redes del organizador validadas por dominio', async () => {
    const cur = await ctx.http.get('/v1/settings/branding').set(as(t.ownerToken, t.org.id)).expect(200);
    const put = (data: object) => ctx.http.put('/v1/settings/branding').set(as(t.ownerToken, t.org.id)).send({ revision: cur.body.revision, data: { ...cur.body.data, ...data } });
    expect((await put({ instagramUrl: 'https://evil.com/rifas' }).expect(400)).body.details[0].message).toBe('Ese enlace no es de la red social indicada.');
    await put({ instagramUrl: 'https://www.instagram.com/rifasdemichellys' }).expect(200);
    const raffle = await createRaffle(ctx, t);
    const pub = await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}`).expect(200);
    expect(pub.body.organization.social.instagram).toBe('https://www.instagram.com/rifasdemichellys');
  });

  it('vista previa al compartir: etiquetas Open Graph sin HTML inyectado', async () => {
    const raffle = await createRaffle(ctx, t);
    await ctx.http.patch(`/v1/raffles/${raffle.id}`).set(as(t.ownerToken, t.org.id)).send({ title: 'Moto <script>alert(1)</script>' }).expect(200);
    const res = await ctx.http.get(`/v1/public/share/${t.org.slug}/${raffle.slug}`).expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('<meta property="og:title" content="Moto &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(res.text).not.toContain('<script>');
    expect(res.text).toContain('Cada número $6.000');
    expect(res.text).toContain(`http-equiv="refresh" content="0;url=http://localhost:5173/${t.org.slug}/${raffle.slug}"`);
  });

  it('nombre de la unidad: se valida y llega a la página pública', async () => {
    const raffle = await createRaffle(ctx, t, { extra: { unitLabel: 'Boleta', unitLabelPlural: 'boletas' } });
    const pub = await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}`).expect(200);
    expect(pub.body.raffle).toMatchObject({ unitLabel: 'boleta', unitLabelPlural: 'boletas' });
    expect(await createRaffle(ctx, t)).toMatchObject({ unitLabel: 'número', unitLabelPlural: 'números' });
    await ctx.http.patch(`/v1/raffles/${raffle.id}`).set(as(t.ownerToken, t.org.id)).send({ unitLabel: 'boleta #1' }).expect(400);
  });
});
