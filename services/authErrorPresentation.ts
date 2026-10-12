export type AuthFailureKind =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'backend_unreachable'
  | 'session_expired'
  | 'rate_limited'
  | 'account_restricted'
  | 'unknown';

export interface PresentedAuthError {
  kind: AuthFailureKind;
  message: string;
  retryable: boolean;
  status?: number;
}

type ErrorLike = {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  message?: unknown;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

export function presentAuthError(error: unknown): PresentedAuthError {
  const candidate = (error && typeof error === 'object' ? error : {}) as ErrorLike;
  const code = text(candidate.code);
  const message = text(candidate.message);
  const name = text(candidate.name);
  const status = typeof candidate.status === 'number' && Number.isFinite(candidate.status)
    ? candidate.status
    : undefined;

  if (
    code === 'invalid_credentials'
    || message.includes('invalid login credentials')
    || message.includes('invalid credentials')
  ) {
    return {
      kind: 'invalid_credentials',
      message: 'Correo o contraseña incorrectos.',
      retryable: true,
      ...(status === undefined ? {} : { status }),
    };
  }

  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return {
      kind: 'email_not_confirmed',
      message: 'Confirma tu correo antes de iniciar sesión.',
      retryable: false,
      ...(status === undefined ? {} : { status }),
    };
  }

  if (
    code === 'refresh_token_not_found'
    || code === 'refresh_token_already_used'
    || message.includes('jwt expired')
    || message.includes('refresh token')
  ) {
    return {
      kind: 'session_expired',
      message: 'Tu sesión expiró. Inicia sesión de nuevo.',
      retryable: true,
      ...(status === undefined ? {} : { status }),
    };
  }

  if (
    status === 429
    || code.includes('rate_limit')
    || message.includes('rate limit')
    || message.includes('too many requests')
  ) {
    return {
      kind: 'rate_limited',
      message: 'Demasiados intentos. Espera un momento y vuelve a intentarlo.',
      retryable: true,
      ...(status === undefined ? {} : { status }),
    };
  }

  if (
    code === 'user_banned'
    || message.includes('user is banned')
    || message.includes('account is restricted')
  ) {
    return {
      kind: 'account_restricted',
      message: 'Esta cuenta está restringida.',
      retryable: false,
      ...(status === undefined ? {} : { status }),
    };
  }

  if (
    name === 'typeerror'
    || name === 'aborterror'
    || status === 502
    || status === 503
    || status === 504
    || message.includes('network request failed')
    || message.includes('fetch failed')
    || message.includes('failed to fetch')
    || message.includes('network error')
  ) {
    return {
      kind: 'backend_unreachable',
      message: 'No se pudo conectar al servicio de autenticación. Verifica la red e inténtalo de nuevo.',
      retryable: true,
      ...(status === undefined ? {} : { status }),
    };
  }

  return {
    kind: 'unknown',
    message: 'No se pudo iniciar sesión. Inténtalo de nuevo.',
    retryable: true,
    ...(status === undefined ? {} : { status }),
  };
}
