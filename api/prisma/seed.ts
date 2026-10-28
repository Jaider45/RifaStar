/**
 * Seed de desarrollo (§9).
 *
 *   npm run db:seed          (idempotente: si «michellys» ya existe, no hace nada)
 *   npm run db:reset         (borra todo, migra y vuelve a sembrar)
 *
 * Crea el catálogo base, un super_admin de plataforma, «Rifas de Michellys»
 * (plan Pro) con su equipo, sorteo activo, 62 números pagos, 7 pagos por
 * verificar, dos sorteos anteriores ya jugados y el ranking del mes; y una
 * segunda organización en prueba («Moto Ya») para probar el aislamiento.
 */
import { type Participant, PrismaClient, type PrizeRule } from '@prisma/client';
import argon2 from 'argon2';
import { addDays } from 'date-fns';
import { randomUUID } from 'node:crypto';
import { encrypt, sha256 } from '../src/common/crypto';
import { ticketCode } from '../src/common/format';
import { localToUtc, utcToLocal } from '../src/common/time';
import { orderAccessToken } from '../src/orders/reservation.service';
import { periodFor } from '../src/ranking/periods';
import { winningNumber } from '../src/results/winner-rules';
import { defaultSettings } from '../src/settings/schemas';
import { seedBase } from './seed-base';

const prisma = new PrismaClient({ datasourceUrl: process.env.SYSTEM_DATABASE_URL ?? process.env.DATABASE_URL });
const TZ = 'America/Bogota';
const PASSWORD = 'clave-segura-123';
const ADMIN_PASSWORD = 'RifaStar-dev-2026';
/** Secreto TOTP fijo SOLO para desarrollo (agrégalo a tu app de autenticación). */
const DEV_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

const hours = (n: number) => n * 3_600_000;

/** Próximo sábado a la hora local indicada (si hoy es sábado y ya pasó, el siguiente). */
function nextSaturday(hour: number, minute: number): Date {
  const local = utcToLocal(new Date(), TZ);
  let d = new Date(local.getFullYear(), local.getMonth(), local.getDate(), hour, minute);
  const daysAhead = (6 - local.getDay() + 7) % 7;
  d = addDays(d, daysAhead);
  if (localToUtc(d, TZ).getTime() - Date.now() < hours(20)) d = addDays(d, 7);
  return localToUtc(d, TZ);
}
const sameDayAt = (draw: Date, hour: number, minute: number) => {
  const l = utcToLocal(draw, TZ);
  return localToUtc(new Date(l.getFullYear(), l.getMonth(), l.getDate(), hour, minute), TZ);
};

const BOYACA_PRIZES = (
  anticipatedAt: Date,
): { amountCop: number; rule: PrizeRule; anticipatedLottery?: string; anticipatedDrawCode?: string; anticipatedDrawAt?: Date }[] => [
  { amountCop: 200_000, rule: 'last_two' },
  { amountCop: 80_000, rule: 'first_two' },
  { amountCop: 70_000, rule: 'middle_two' },
  { amountCop: 50_000, rule: 'digits_1_and_4' },
  { amountCop: 30_000, rule: 'anticipated_last_two', anticipatedLottery: 'Antioqueñita', anticipatedDrawCode: 'antioquenita-tarde', anticipatedDrawAt: anticipatedAt },
];

/** Los 62 números vendidos del mock del frontend. */
const SOLD = [0, 1, 2, 3, 5, 9, 11, 12, 14, 15, 17, 18, 20, 21, 22, 26, 27, 28, 30, 33, 34, 35, 37, 40, 41, 42, 44, 45, 47, 50, 51, 53, 55, 56, 58, 60, 61, 63, 66, 67, 69, 70, 71, 72, 74, 77, 78, 79, 81, 83, 84, 86, 88, 89, 90, 92, 93, 95, 96, 97, 98, 99];

const PARTICIPANTS: [string, string][] = [
  ['Laura Martínez', '+573004127781'],
  ['Carlos Rincón', '+573112290045'],
  ['Yeni Pacheco', '+573206614410'],
  ['Andrés Gil', '+573150937720'],
  ['Marta López', '+573014412208'],
  ['Dayana Ruiz', '+573185501192'],
  ['Jhon Ospina', '+573042208813'],
  ['Paola Castro', '+573163303307'],
  ['Wilmer Durán', '+573125565561'],
  ['Sandra Vélez', '+573059029024'],
  ['Luz Mery Cárdenas', '+573176604412'],
  ['Óscar Benítez', '+573008891234'],
  ['Natalia Restrepo', '+573137720019'],
  ['Hernán Quintero', '+573215508832'],
  ['Kelly Barrios', '+573046671290'],
  ['Diego Cuervo', '+573102234478'],
  ['Viviana Rojas', '+573189907765'],
  ['Fredy Montoya', '+573017781203'],
  ['Lina Arango', '+573228810045'],
  ['Mauricio Peña', '+573126609981'],
];

/** Peso de cada participante al repartir números (suma 62: los vendidos del sorteo actual). */
const WEIGHTS = [8, 7, 6, 5, 5, 4, 4, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1];

/** Lista de índices de participante, proporcional a los pesos, de largo `total`. */
function distribute(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (w * total) / sum);
  const counts = exact.map(Math.floor);
  const order = exact.map((e, i) => [e - Math.floor(e), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; counts.reduce((a, b) => a + b, 0) < total; k++) counts[order[k][1]]++;
  return counts.flatMap((c, i) => Array.from({ length: c }, () => i));
}

/** 7 pagos por verificar del mock (05, 40 y 41 están vendidos en el mock: se usan 04, 06 y 07). */
const PENDING: [number, number[]][] = [
  [0, [24]],
  [1, [6, 7, 76]],
  [2, [4]],
  [3, [48, 49]],
  [4, [73]],
  [5, [16, 19]],
  [6, [62]],
];

async function main() {
  await seedBase(prisma);

  // Los datos de ejemplo traen claves y un secreto 2FA públicos (están en el README):
  // en producción solo se siembra el catálogo base.
  if (process.env.NODE_ENV === 'production') {
    console.log('Producción: catálogo base listo. Los datos de ejemplo (usuarios con claves conocidas) no se crean.');
    return;
  }

  if (await prisma.organization.findUnique({ where: { slug: 'michellys' } })) {
    console.log('El seed de ejemplo ya existe (usa «npm run db:reset» para empezar de cero).');
    return;
  }

  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const plans = Object.fromEntries((await prisma.plan.findMany()).map((p) => [p.code, p]));
  const roles = Object.fromEntries((await prisma.role.findMany({ where: { organizationId: null } })).map((r) => [r.key, r]));

  // --- Plataforma -------------------------------------------------------------
  await prisma.platformUser.upsert({
    where: { email: 'admin@rifastar.co' },
    update: {},
    create: {
      email: 'admin@rifastar.co',
      name: 'Admin Rifa Star',
      role: 'super_admin',
      passwordHash: await argon2.hash(ADMIN_PASSWORD, { type: argon2.argon2id }),
      totpSecretEnc: encrypt(DEV_TOTP_SECRET),
      totpEnabledAt: new Date(),
    },
  });

  // --- Rifas de Michellys --------------------------------------------------------
  const org = await prisma.organization.create({
    data: {
      name: 'Rifas de Michellys',
      slug: 'michellys',
      supportWhatsapp: '+573168110777',
      defaultAccentColor: '#7eb742',
      timezone: TZ,
      status: 'active',
    },
  });
  await prisma.subscription.create({
    data: { organizationId: org.id, planId: plans.pro.id, status: 'active', provider: 'manual', currentPeriodStart: new Date(), currentPeriodEnd: addDays(new Date(), 30) },
  });

  const team: [string, string, string, string | null][] = [
    ['Michellys Tovar', 'michellys@correo.com', 'owner', null],
    ['José Rodríguez', 'jose@correo.com', 'admin', null],
    ['Karen Díaz', 'karen@correo.com', 'payment_verifier', null],
    ['Luis Mora', 'luis@correo.com', 'seller', 'LUIS'],
  ];
  const members: Record<string, string> = {};
  for (const [name, email, roleKey, sellerCode] of team) {
    // Los gestores (aprueban pagos o anuncian ganadores) tienen 2FA; el vendedor no lo necesita.
    const twoFactor = roleKey !== 'seller' ? { totpSecretEnc: encrypt(DEV_TOTP_SECRET), totpEnabledAt: new Date() } : {};
    const user = await prisma.user.upsert({ where: { email }, update: {}, create: { email, name, passwordHash, ...twoFactor } });
    const m = await prisma.member.create({
      data: { organizationId: org.id, userId: user.id, roleId: roles[roleKey].id, status: 'active', joinedAt: new Date(), sellerCode },
    });
    members[roleKey] = m.id;
  }

  const settings = {
    payments: defaultSettings('payments'),
    notifications: { ...defaultSettings('notifications'), dailyDigest: true },
    branding: defaultSettings('branding'),
    ranking: {
      ...defaultSettings('ranking'),
      enabled: true,
      consistencyBonus: { enabled: true, minRaffles: 3, points: 5 },
      referralBonus: { enabled: true, points: 3 },
      prizes: ['$300.000 en efectivo', '10 números gratis', '5 números gratis'],
      announceOnClose: true,
    },
  };
  await prisma.orgSettings.createMany({
    data: Object.entries(settings).map(([section, data]) => ({ organizationId: org.id, section: section as never, data })),
  });

  const account = await prisma.paymentAccount.create({
    data: { organizationId: org.id, type: 'bre_b', keyOrNumber: '3168110777', holderName: 'José Rodríguez' },
  });

  const participants: Participant[] = [];
  for (const [i, [name, phone]] of PARTICIPANTS.entries()) {
    participants.push(
      await prisma.participant.create({
        data: {
          organizationId: org.id,
          name,
          phone,
          referralCode: `REF${String(i + 1).padStart(5, '0')}`,
          firstSeenAt: new Date(Date.now() - (60 - i) * 86_400_000),
        },
      }),
    );
  }

  const drawAt = nextSaturday(22, 40);
  const pastDraws = [addDays(drawAt, -14), addDays(drawAt, -7)];
  const now = Date.now();
  const period = periodFor(new Date(), TZ, 'monthly');
  const rankingPeriod = await prisma.rankingPeriod.create({
    data: { organizationId: org.id, frequency: 'monthly', label: period.label, startsAt: period.startsAt, endsAt: period.endsAt },
  });

  let sequence = 0;
  const pointsByParticipant = new Map<string, Set<string>>();

  /** Crea un sorteo con números, órdenes aprobadas por participante y tickets. */
  async function raffleWithSales(opts: {
    title: string;
    slug: string;
    drawAt: Date;
    status: 'active' | 'drawn';
    paid: number[];
    approvedAt: (i: number) => Date;
  }) {
    sequence++;
    const raffle = await prisma.raffle.create({
      data: {
        organizationId: org.id,
        sequence,
        slug: opts.slug,
        title: opts.title,
        lottery: 'Lotería de Boyacá',
        lotteryDrawCode: 'loteria-de-boyaca',
        drawAt: opts.drawAt,
        salesCloseAt: sameDayAt(opts.drawAt, 15, 30),
        pricePerNumber: 6000,
        digits: 2,
        totalNumbers: 100,
        minPerOrder: 1,
        accentColor: '#7eb742',
        conditionText: 'Participan los números totalmente pagos antes de las 3:30 p. m.',
        status: opts.status,
        publishedAt: new Date(opts.drawAt.getTime() - hours(24 * 6)),
        ...(opts.status === 'drawn' && { closedAt: sameDayAt(opts.drawAt, 15, 30), drawnAt: opts.drawAt, resultsPublishedAt: new Date(opts.drawAt.getTime() + hours(1)) }),
        createdById: members.owner,
      },
    });
    const prizes = BOYACA_PRIZES(sameDayAt(opts.drawAt, 16, 0));
    await prisma.prize.createMany({ data: prizes.map((p, i) => ({ ...p, organizationId: org.id, raffleId: raffle.id, position: i + 1 })) });
    await prisma.rafflePaymentAccount.create({ data: { raffleId: raffle.id, paymentAccountId: account.id, organizationId: org.id } });

    // Reparte los números pagados con pesos decrecientes (Laura primero, como en el mock).
    const owners = new Map<string, number[]>();
    const slots = distribute(opts.paid.length, WEIGHTS);
    opts.paid.forEach((n, i) => {
      const p = participants[slots[(i * 7) % slots.length]];
      owners.set(p.id, [...(owners.get(p.id) ?? []), n]);
    });
    let k = 0;
    for (const [participantId, numbers] of owners) {
      const approvedAt = opts.approvedAt(k++);
      const orderId = randomUUID();
      await prisma.order.create({
        data: {
          id: orderId,
          organizationId: org.id,
          raffleId: raffle.id,
          participantId,
          numbers,
          unitPrice: 6000,
          totalCop: 6000 * numbers.length,
          status: 'approved',
          reservedUntil: new Date(approvedAt.getTime() - hours(1)),
          accessTokenHash: sha256(orderAccessToken(orderId)),
          receiptUploadedAt: new Date(approvedAt.getTime() - hours(1)),
          verifiedById: members.payment_verifier,
          verifiedAt: approvedAt,
          sellerMemberId: k % 5 === 0 ? members.seller : null,
          sellerCode: k % 5 === 0 ? 'LUIS' : null,
          createdAt: new Date(approvedAt.getTime() - hours(2)),
        },
      });
      await prisma.raffleNumber.createMany({
        data: numbers.map((number) => ({ raffleId: raffle.id, number, organizationId: org.id, status: 'paid' as const, orderId, paidAt: approvedAt })),
      });
      await prisma.ticket.createMany({
        data: numbers.map((n) => ({
          organizationId: org.id,
          raffleId: raffle.id,
          orderId,
          participantId,
          number: n,
          code: ticketCode(sequence, n, 2),
          issuedAt: approvedAt,
        })),
      });
      // Puntos del ranking: solo lo aprobado dentro del periodo actual.
      if (approvedAt >= period.startsAt && approvedAt < period.endsAt) {
        await prisma.pointsEvent.create({
          data: {
            organizationId: org.id,
            periodId: rankingPeriod.id,
            participantId,
            points: numbers.length,
            reason: 'number_paid',
            orderId,
            raffleId: raffle.id,
            idempotencyKey: `order:${orderId}:paid`,
            createdAt: approvedAt,
          },
        });
        pointsByParticipant.set(participantId, (pointsByParticipant.get(participantId) ?? new Set()).add(raffle.id));
      }
    }
    await prisma.raffle.update({ where: { id: raffle.id }, data: { paidCount: opts.paid.length } });
    return raffle;
  }

  // Dos sorteos anteriores (agotados, jugados y con ganadores entregados).
  const all = Array.from({ length: 100 }, (_, n) => n);
  const pastResults = [
    { main: '4087', anticipated: '1131' },
    { main: '2435', anticipated: '9107' },
  ];
  for (const [i, past] of pastDraws.entries()) {
    const label = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: TZ }).format(past).replace('.', '');
    const raffle = await raffleWithSales({
      title: `Gana con Boyacá · ${label}`,
      slug: `boyaca-${i === 0 ? 'hace-dos-semanas' : 'semana-pasada'}`,
      drawAt: past,
      status: 'drawn',
      paid: all,
      approvedAt: (k) => new Date(past.getTime() - hours(30) + k * 60_000),
    });
    const result = await prisma.drawResult.create({
      data: {
        organizationId: org.id,
        raffleId: raffle.id,
        mainResult: pastResults[i].main,
        anticipatedResult: pastResults[i].anticipated,
        enteredById: members.owner,
        enteredAt: new Date(past.getTime() + hours(0.5)),
        publishedAt: new Date(past.getTime() + hours(1)),
        winnersNotifiedAt: new Date(past.getTime() + hours(1)),
      },
    });
    const prizes = await prisma.prize.findMany({ where: { raffleId: raffle.id }, orderBy: { position: 'asc' } });
    for (const prize of prizes) {
      const number = winningNumber(prize.rule, 2, result.mainResult, result.anticipatedResult)!;
      const owner = await prisma.raffleNumber.findUniqueOrThrow({ where: { raffleId_number: { raffleId: raffle.id, number } }, include: { order: true } });
      const ticket = await prisma.ticket.findFirst({ where: { raffleId: raffle.id, number, status: 'valid' } });
      await prisma.winner.create({
        data: {
          organizationId: org.id,
          raffleId: raffle.id,
          prizeId: prize.id,
          drawResultId: result.id,
          number,
          participantId: owner.order!.participantId,
          ticketId: ticket?.id,
          deliveryStatus: i === 0 ? 'delivered' : 'pending',
          deliveredAt: i === 0 ? new Date(past.getTime() + hours(14)) : null,
          deliveredById: i === 0 ? members.owner : null,
        },
      });
    }
  }

  // Sorteo activo: 62 números pagados + 7 pagos por verificar.
  const current = await raffleWithSales({
    title: 'Gana con Boyacá · Sorteo semanal',
    slug: 'gana-con-boyaca-sorteo-semanal',
    drawAt,
    status: 'active',
    paid: SOLD,
    approvedAt: (k) => new Date(now - hours(30) + k * 25 * 60_000),
  });
  let held = 0;
  for (const [i, [pIdx, numbers]] of PENDING.entries()) {
    const orderId = randomUUID();
    const uploadedAt = new Date(now - (28 - i * 4) * 60_000);
    await prisma.order.create({
      data: {
        id: orderId,
        organizationId: org.id,
        raffleId: current.id,
        participantId: participants[pIdx].id,
        numbers,
        unitPrice: 6000,
        totalCop: 6000 * numbers.length,
        status: 'pending_verification',
        reservedUntil: new Date(uploadedAt.getTime() + 30 * 60_000),
        accessTokenHash: sha256(orderAccessToken(orderId)),
        receiptUploadedAt: uploadedAt,
        createdAt: new Date(uploadedAt.getTime() - 3 * 60_000),
      },
    });
    await prisma.raffleNumber.createMany({
      data: numbers.map((number) => ({ raffleId: current.id, number, organizationId: org.id, status: 'pending_verification' as const, orderId })),
    });
    held += numbers.length;
  }
  await prisma.raffle.update({ where: { id: current.id }, data: { heldCount: held } });

  // Bono de constancia (3 sorteos en el periodo).
  for (const [participantId, raffles] of pointsByParticipant) {
    if (raffles.size >= 3) {
      await prisma.pointsEvent.create({
        data: {
          organizationId: org.id,
          periodId: rankingPeriod.id,
          participantId,
          points: 5,
          reason: 'consistency_bonus',
          idempotencyKey: `bonus:consistency:${rankingPeriod.id}:${participantId}`,
        },
      });
    }
  }

  // «Avísame del próximo sorteo».
  for (const p of participants.slice(15)) {
    await prisma.notifyMeSubscription.create({ data: { organizationId: org.id, participantId: p.id } });
  }

  // Sorteo de 5 cifras (100.000 números): juega con las 4 cifras de la Lotería de Medellín más
  // la última cifra de la serie; los números se asignan al azar (mínimo 2 por participante).
  sequence++;
  const navidad = await prisma.raffle.create({
    data: {
      organizationId: org.id,
      sequence,
      slug: 'gran-rifa-de-navidad',
      title: 'Gran rifa de Navidad · Moto 0 km',
      lottery: 'Lotería de Medellín',
      lotteryDrawCode: 'loteria-de-medellin',
      drawAt: addDays(drawAt, 56),
      pricePerNumber: 5000,
      digits: 5,
      totalNumbers: 100_000,
      minPerOrder: 2,
      numberSelection: 'random',
      extraDigitsSource: 'series',
      extraDigitsPosition: 'end',
      accentColor: '#ab1f24',
      conditionText: 'Juega con las 4 cifras de la Lotería de Medellín más la última cifra de la serie.',
      pageConfig: {
        theme: 'dark',
        description: '**Una moto 0 km** para estrenar en Navidad.\n\n- Papeles al día\n- Entrega en Medellín\n- Sorteo transmitido en vivo',
        faq: [
          {
            q: '¿Cómo se arma el número ganador?',
            a: 'Son las 4 cifras de la Lotería de Medellín más la última cifra de la serie. Ejemplo: 4058 serie 127 → 40587.',
          },
        ],
        show: { countdown: true, progress: true, remaining: true, organizer: true, ranking: true, social: true },
      },
      status: 'active',
      publishedAt: new Date(),
      createdById: members.owner,
    },
  });
  await prisma.prize.create({ data: { organizationId: org.id, raffleId: navidad.id, position: 1, description: 'Moto Yamaha NMAX 2027 0 km', rule: 'full_number' } });
  await prisma.rafflePaymentAccount.create({ data: { raffleId: navidad.id, paymentAccountId: account.id, organizationId: org.id } });
  const navidadOrder = randomUUID();
  const navidadNumbers = [12345, 40587, 77001];
  await prisma.order.create({
    data: {
      id: navidadOrder,
      organizationId: org.id,
      raffleId: navidad.id,
      participantId: participants[0].id,
      numbers: navidadNumbers,
      unitPrice: 5000,
      totalCop: 5000 * navidadNumbers.length,
      status: 'approved',
      reservedUntil: new Date(now - hours(2)),
      accessTokenHash: sha256(orderAccessToken(navidadOrder)),
      verifiedById: members.payment_verifier,
      verifiedAt: new Date(now - hours(1)),
    },
  });
  await prisma.raffleNumber.createMany({
    data: navidadNumbers.map((number) => ({ raffleId: navidad.id, number, organizationId: org.id, status: 'paid' as const, orderId: navidadOrder, paidAt: new Date(now - hours(1)) })),
  });
  await prisma.ticket.createMany({
    data: navidadNumbers.map((n) => ({ organizationId: org.id, raffleId: navidad.id, orderId: navidadOrder, participantId: participants[0].id, number: n, code: ticketCode(sequence, n, 5) })),
  });
  await prisma.raffle.update({ where: { id: navidad.id }, data: { paidCount: navidadNumbers.length } });

  await prisma.organization.update({ where: { id: org.id }, data: { raffleSequence: sequence } });

  // --- Moto Ya: segunda organización, en prueba (aislamiento entre tenants) -----
  const trial = await prisma.trialConfig.findUniqueOrThrow({ where: { id: 1 } });
  const felipe = await prisma.user.upsert({
    where: { email: 'felipe@correo.com' },
    update: {},
    create: { email: 'felipe@correo.com', name: 'Felipe Arango', passwordHash, totpSecretEnc: encrypt(DEV_TOTP_SECRET), totpEnabledAt: new Date() },
  });
  const motoya = await prisma.organization.create({
    data: { name: 'Moto Ya', slug: 'motoya', timezone: TZ, status: 'trial', trialEndsAt: addDays(new Date(), 9), raffleSequence: 1 },
  });
  await prisma.subscription.create({
    data: { organizationId: motoya.id, planId: trial.planId, status: 'trialing', provider: 'manual', trialEndsAt: motoya.trialEndsAt, currentPeriodStart: new Date(), currentPeriodEnd: motoya.trialEndsAt },
  });
  await prisma.member.create({ data: { organizationId: motoya.id, userId: felipe.id, roleId: roles.owner.id, status: 'active', joinedAt: new Date() } });
  await prisma.orgSettings.createMany({
    data: (['payments', 'ranking', 'notifications', 'branding'] as const).map((section) => ({ organizationId: motoya.id, section, data: defaultSettings(section) })),
  });
  const motoAccount = await prisma.paymentAccount.create({
    data: { organizationId: motoya.id, type: 'nequi', keyOrNumber: '3205551122', holderName: 'Felipe Arango' },
  });
  const moto = await prisma.raffle.create({
    data: {
      organizationId: motoya.id,
      sequence: 1,
      slug: 'moto-yamaha-nmax-2027',
      title: 'Moto Yamaha NMAX 2027',
      lottery: 'Lotería de Medellín',
      lotteryDrawCode: 'loteria-de-medellin',
      drawAt: addDays(drawAt, 21),
      pricePerNumber: 10_000,
      digits: 3,
      totalNumbers: 1000,
      status: 'active',
      publishedAt: new Date(),
    },
  });
  await prisma.prize.create({ data: { organizationId: motoya.id, raffleId: moto.id, position: 1, description: 'Moto Yamaha NMAX 2027', rule: 'last_three' } });
  await prisma.rafflePaymentAccount.create({ data: { raffleId: moto.id, paymentAccountId: motoAccount.id, organizationId: motoya.id } });
  // Mismo teléfono que Laura en Michellys: es otro participante (único por organización).
  const lauraMoto = await prisma.participant.create({ data: { organizationId: motoya.id, name: 'Laura M.', phone: '+573004127781' } });
  const motoOrder = randomUUID();
  await prisma.order.create({
    data: {
      id: motoOrder,
      organizationId: motoya.id,
      raffleId: moto.id,
      participantId: lauraMoto.id,
      numbers: [715],
      unitPrice: 10_000,
      totalCop: 10_000,
      status: 'approved',
      reservedUntil: new Date(),
      accessTokenHash: sha256(orderAccessToken(motoOrder)),
      verifiedAt: new Date(),
    },
  });
  await prisma.raffleNumber.create({ data: { raffleId: moto.id, number: 715, organizationId: motoya.id, status: 'paid', orderId: motoOrder, paidAt: new Date() } });
  await prisma.ticket.create({ data: { organizationId: motoya.id, raffleId: moto.id, orderId: motoOrder, participantId: lauraMoto.id, number: 715, code: ticketCode(1, 715, 3) } });
  await prisma.raffle.update({ where: { id: moto.id }, data: { paidCount: 1 } });

  // --- Verificación de consistencia ---------------------------------------------
  for (const r of await prisma.raffle.findMany()) {
    const paid = await prisma.raffleNumber.count({ where: { raffleId: r.id, status: 'paid' } });
    const pending = await prisma.raffleNumber.count({ where: { raffleId: r.id, status: { in: ['reserved', 'pending_verification'] } } });
    if (paid !== r.paidCount || pending !== r.heldCount) throw new Error(`Contadores inconsistentes en ${r.slug}`);
  }

  const top = await prisma.$queryRaw<{ name: string; points: number }[]>`
    SELECT p.name, SUM(e.points)::int AS points FROM points_events e JOIN participants p ON p.id = e.participant_id
     WHERE e.period_id = ${rankingPeriod.id}::uuid GROUP BY p.name ORDER BY points DESC LIMIT 3`;

  console.log(`
Seed listo.

Plataforma (2FA obligatorio)
  admin@rifastar.co / ${ADMIN_PASSWORD}
  Secreto TOTP de desarrollo: ${DEV_TOTP_SECRET}  (agrégalo a tu app de autenticación)

Rifas de Michellys (plan Pro) · contraseña de todos: ${PASSWORD}
  owner     michellys@correo.com   (2FA con el secreto TOTP de desarrollo)
  admin     jose@correo.com        (2FA)
  verifica  karen@correo.com       (2FA)
  vendedor  luis@correo.com (código LUIS, sin 2FA)
  Sorteo:   /v1/public/orgs/michellys/raffles/gana-con-boyaca-sorteo-semanal
  5 cifras: /v1/public/orgs/michellys/raffles/gran-rifa-de-navidad (al azar, mínimo 2)
  Ranking ${period.label}: ${pointsByParticipant.size} participantes · top: ${top.map((t) => `${t.name} (${t.points})`).join(', ')}

Moto Ya (en prueba): felipe@correo.com / ${PASSWORD} (2FA)
`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
