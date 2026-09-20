// Signup input checks are for UX only. Supabase Auth and private.age_evaluate_dob
// remain the server authority for eligibility.
export const formatLocalCalendarDate = (date: Date): string =>
  `${date.getFullYear().toString().padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function validateSignupDob(value: string, today = new Date()): 'required' | 'invalid' | 'future' | null {
  if (!value.trim()) return 'required';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'invalid';
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return 'invalid';
  if (value > formatLocalCalendarDate(today)) return 'future';
  return null;
}

export const signupMetadata = (username: string, dateOfBirth: string) => ({
  username,
  date_of_birth: dateOfBirth,
});

export const signupErrorMessage = (message: string): string =>
  message.includes('at least 18 years old')
    ? 'Debes tener al menos 18 años para crear una cuenta en Nelyon.'
    : message;
