import { getSupabaseClient } from '@/template';

export type AgeEligibilityState =
  | 'complete'
  | 'remediation_required'
  | 'ineligible'
  | 'unavailable';

export type AgeEligibilityStatus = {
  authority: 'private.user_age_eligibility';
  state: AgeEligibilityState;
  evaluated: boolean;
  birth_date_present: boolean;
  remediation_required: boolean;
  policy_version: string;
  minimum_age: number;
};

const validStates = new Set<AgeEligibilityState>([
  'complete',
  'remediation_required',
  'ineligible',
  'unavailable',
]);

function parseStatus(value: unknown): AgeEligibilityStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('age_eligibility_status_invalid');
  }
  const row = value as Record<string, unknown>;
  if (
    row.authority !== 'private.user_age_eligibility'
    || typeof row.state !== 'string'
    || !validStates.has(row.state as AgeEligibilityState)
    || typeof row.evaluated !== 'boolean'
    || typeof row.birth_date_present !== 'boolean'
    || typeof row.remediation_required !== 'boolean'
    || typeof row.policy_version !== 'string'
    || typeof row.minimum_age !== 'number'
  ) {
    throw new Error('age_eligibility_status_invalid');
  }
  return row as AgeEligibilityStatus;
}

export async function getMyAgeEligibilityStatus(): Promise<AgeEligibilityStatus> {
  const { data, error } = await getSupabaseClient().rpc('get_my_age_eligibility_status_v2');
  if (error) throw new Error(error.message || 'age_eligibility_status_unavailable');
  return parseStatus(data);
}

export async function remediateMyAgeEligibility(dateOfBirth: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc('remediate_my_age_eligibility', {
    p_date_of_birth: dateOfBirth,
  });
  if (error) throw new Error(error.message || 'age_eligibility_remediation_failed');
}
