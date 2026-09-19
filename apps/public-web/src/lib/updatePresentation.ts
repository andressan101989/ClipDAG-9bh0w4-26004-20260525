export const availabilityLabels = {
  available: 'Available',
  rolling_out: 'Rolling out',
  preview: 'Preview',
  coming_soon: 'Coming soon',
} as const;

export function formatUpdateDate(date: Date): string {
  return new Intl.DateTimeFormat('en', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}
