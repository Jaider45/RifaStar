import { displayName } from '../src/common/privacy';
import { composeFullNumber, ruleAppliesTo, winningNumber, WinnerRuleError } from '../src/results/winner-rules';

describe('Reglas de ganadores (módulo puro)', () => {
  describe('2 cifras con resultado 2435 (ejemplo aprobado en P3)', () => {
    it('last_two = CD → 35 (el 43 no gana)', () => {
      expect(winningNumber('last_two', 2, '2435')).toBe(35);
      expect(winningNumber('last_two', 2, '2435')).not.toBe(43);
    });
    it('first_two = AB → 24', () => expect(winningNumber('first_two', 2, '2435')).toBe(24));
    it('middle_two = BC → 43', () => expect(winningNumber('middle_two', 2, '2435')).toBe(43));
    it('digits_1_and_4 = AD → 25', () => expect(winningNumber('digits_1_and_4', 2, '2435')).toBe(25));
    it('anticipated_last_two = dos últimas del anticipado', () => {
      expect(winningNumber('anticipated_last_two', 2, '2435', '9107')).toBe(7);
      expect(winningNumber('anticipated_last_two', 2, '2435', null)).toBeNull();
    });
  });

  describe('ceros a la izquierda', () => {
    it('resultado 0507', () => {
      expect(winningNumber('last_two', 2, '0507')).toBe(7);
      expect(winningNumber('first_two', 2, '0507')).toBe(5);
      expect(winningNumber('middle_two', 2, '0507')).toBe(50);
      expect(winningNumber('digits_1_and_4', 2, '0507')).toBe(7);
      expect(winningNumber('full_number', 4, '0007')).toBe(7);
      expect(winningNumber('last_three', 3, '9007')).toBe(7);
    });
  });

  describe('3 cifras (resultado 4087)', () => {
    it('last_three = BCD → 087', () => expect(winningNumber('last_three', 3, '4087')).toBe(87));
    it('first_three = ABC → 408', () => expect(winningNumber('first_three', 3, '4087')).toBe(408));
    it('anticipated_full_number = 3 últimas del anticipado', () => expect(winningNumber('anticipated_full_number', 3, '4087', '1234')).toBe(234));
  });

  describe('4 cifras (resultado 4087)', () => {
    it('full_number = ABCD', () => expect(winningNumber('full_number', 4, '4087')).toBe(4087));
    it('anticipated_full_number = anticipado completo', () => expect(winningNumber('anticipated_full_number', 4, '4087', '0012')).toBe(12));
  });

  describe('5 y 6 cifras (resultado 4058, serie 127)', () => {
    const extra = (source: 'series' | 'fifth_digit', position: 'start' | 'end', result: { series?: string; fifthDigit?: string }) => ({
      config: { source, position },
      result,
    });
    it('5 cifras con la última de la serie al final → 40587', () =>
      expect(winningNumber('full_number', 5, '4058', null, extra('series', 'end', { series: '127' }))).toBe(40587));
    it('5 cifras con la serie al inicio → 74058', () =>
      expect(winningNumber('full_number', 5, '4058', null, extra('series', 'start', { series: '127' }))).toBe(74058));
    it('5 cifras con la quinta cifra del chance → 40583', () =>
      expect(winningNumber('full_number', 5, '4058', null, extra('fifth_digit', 'end', { fifthDigit: '3' }))).toBe(40583));
    it('6 cifras con las dos últimas de la serie → 405827', () =>
      expect(winningNumber('full_number', 6, '4058', null, extra('series', 'end', { series: '127' }))).toBe(405827));
    it('6 cifras al inicio conserva los ceros → 074058 = 74058', () =>
      expect(winningNumber('full_number', 6, '4058', null, extra('series', 'start', { series: '907' }))).toBe(74058));
    it('falta el dato o la combinación no existe', () => {
      expect(() => winningNumber('full_number', 5, '4058', null, extra('series', 'end', {}))).toThrow('Falta la serie de la lotería (3 dígitos).');
      expect(() => winningNumber('full_number', 6, '4058', null, extra('fifth_digit', 'end', { fifthDigit: '3' }))).toThrow(WinnerRuleError);
      expect(() => composeFullNumber(5, '4058', { source: null, position: 'end' }, {})).toThrow(WinnerRuleError);
      expect(ruleAppliesTo('last_two', 5)).toBe(false);
      expect(ruleAppliesTo('full_number', 6)).toBe(true);
    });
  });

  it('custom no se calcula', () => expect(winningNumber('custom', 2, '4087')).toBeNull());

  it('rechaza reglas que no aplican a las cifras y resultados mal formados', () => {
    expect(ruleAppliesTo('last_two', 4)).toBe(false);
    expect(ruleAppliesTo('full_number', 2)).toBe(false);
    expect(() => winningNumber('last_two', 4, '4087')).toThrow(WinnerRuleError);
    expect(() => winningNumber('last_two', 2, '487')).toThrow('El resultado debe tener 4 dígitos.');
    expect(() => winningNumber('anticipated_last_two', 2, '4087', '12a4')).toThrow(WinnerRuleError);
  });

  it('formato de nombre público (regla 7)', () => {
    expect(displayName({ name: 'laura martínez' }, 'first_name_initial')).toBe('Laura M.');
    expect(displayName({ name: 'Laura Martínez Gómez' }, 'initials')).toBe('L. M.');
    expect(displayName({ name: 'Laura Martínez', nickname: 'La Suertuda' }, 'nickname')).toBe('La Suertuda');
    expect(displayName({ name: 'Laura Martínez', nickname: null }, 'nickname')).toBe('Laura M.');
    expect(displayName({ name: 'Jhon' }, 'first_name_initial')).toBe('Jhon');
  });
});
