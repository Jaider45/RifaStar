import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { Errors } from './errors';

/** Normaliza a E.164. Sin indicativo se asume Colombia (+57). */
export function normalizePhone(input: string, defaultCountry: 'CO' = 'CO'): string {
  const parsed = parsePhoneNumberFromString(input.trim(), defaultCountry);
  if (!parsed || !parsed.isValid()) {
    throw Errors.validation({ field: 'phone' }, 'El número de WhatsApp no es válido.');
  }
  return parsed.number;
}

export function tryNormalizePhone(input: string): string | null {
  try {
    return normalizePhone(input);
  } catch {
    return null;
  }
}

/** «+573004127781» → «***7781». Nunca se expone más que esto en público ni en logs. */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return `***${phone.slice(-4)}`;
}
