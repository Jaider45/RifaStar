import type { MailMessage } from './mail.provider';

export function invitationMail(to: string, orgName: string, roleName: string, link: string): MailMessage {
  return {
    to,
    subject: `Te invitaron a ${orgName} en Rifa Star`,
    text: [
      `Hola:`,
      ``,
      `${orgName} te invitó a su equipo en Rifa Star como «${roleName}».`,
      `Acepta la invitación aquí (vence en 7 días):`,
      link,
      ``,
      `Si no esperabas este correo, ignóralo.`,
    ].join('\n'),
  };
}

export function passwordResetMail(to: string, link: string): MailMessage {
  return {
    to,
    subject: 'Restablece tu contraseña de Rifa Star',
    text: [
      `Recibimos una solicitud para cambiar tu contraseña.`,
      `Crea una nueva aquí (vence en 1 hora):`,
      link,
      ``,
      `Si no la pediste, ignora este correo: tu contraseña sigue igual.`,
    ].join('\n'),
  };
}

export function newDeviceMail(to: string, when: string, device: string, link: string): MailMessage {
  return {
    to,
    subject: 'Nuevo inicio de sesión en tu cuenta de Rifa Star',
    text: [
      `Alguien entró a tu cuenta de Rifa Star desde un equipo nuevo.`,
      ``,
      `Cuándo: ${when}`,
      `Equipo: ${device}`,
      ``,
      `Si fuiste tú, no tienes que hacer nada.`,
      `Si no fuiste tú, cierra todas las sesiones y cambia tu contraseña aquí:`,
      link,
    ].join('\n'),
  };
}

export function managerLotteryResultMail(
  to: string,
  v: { org: string; raffle: string; lottery: string; result: string; status: string; link: string },
): MailMessage {
  return {
    to,
    subject: `Resultado de ${v.lottery} para «${v.raffle}»`,
    text: [
      `LoteríaYa reportó el resultado de ${v.lottery} para el sorteo «${v.raffle}» de ${v.org}:`,
      ``,
      `  ${v.result}  (${v.status})`,
      ``,
      `Este dato es informativo. Compáralo con el resultado oficial de la lotería e ingrésalo en el panel`,
      `para calcular los ganadores:`,
      v.link,
    ].join('\n'),
  };
}

export function managerWinnersMail(
  to: string,
  v: { org: string; raffle: string; result: string; lines: string[]; link: string },
): MailMessage {
  return {
    to,
    subject: `Ganadores de «${v.raffle}»`,
    text: [
      `Estos son los ganadores de «${v.raffle}» (${v.org}) con el resultado ${v.result}:`,
      ``,
      ...v.lines.map((l) => `  • ${l}`),
      ``,
      `Contacta a cada ganador para la entrega y márcala en el panel:`,
      v.link,
    ].join('\n'),
  };
}

export function managerDeliveryReminderMail(to: string, v: { org: string; raffle: string; lines: string[]; link: string }): MailMessage {
  return {
    to,
    subject: `Premios por entregar en «${v.raffle}»`,
    text: [
      `En «${v.raffle}» (${v.org}) todavía hay premios sin marcar como entregados:`,
      ``,
      ...v.lines.map((l) => `  • ${l}`),
      ``,
      `Márcalos en el panel cuando los entregues:`,
      v.link,
    ].join('\n'),
  };
}
