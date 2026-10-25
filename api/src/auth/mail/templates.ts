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
