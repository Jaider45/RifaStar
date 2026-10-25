/** «$6.000» */
export const formatCop = (value: number): string => `$${value.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;

/** 7 con 2 cifras → «07». */
export const formatNumber = (n: number, digits: number): string => String(n).padStart(digits, '0');

export const formatNumberList = (numbers: number[], digits: number): string => {
  const items = numbers.map((n) => formatNumber(n, digits));
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
};

/** RS-0042-07 */
export const ticketCode = (raffleSequence: number, number: number, digits: number): string =>
  `RS-${String(raffleSequence).padStart(4, '0')}-${formatNumber(number, digits)}`;
