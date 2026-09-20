export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class ProviderAuthenticationError extends ProviderError {
  constructor(status?: number) { super('Model provider authentication failed', 'provider_authentication', false, status); }
}

export class ProviderRateLimitError extends ProviderError {
  constructor(status = 429) { super('Model provider rate limit exceeded', 'provider_rate_limit', true, status); }
}

export class ProviderTimeoutError extends ProviderError {
  constructor() { super('Model provider request timed out', 'provider_timeout', true); }
}

export class ProviderContextLengthError extends ProviderError {
  constructor(status?: number) { super('Model provider context is too long', 'provider_context_length', false, status); }
}

export class ProviderModelNotFoundError extends ProviderError {
  constructor(status?: number) { super('Model provider model was not found', 'provider_model_not_found', false, status); }
}

export class ProviderUnavailableError extends ProviderError {
  constructor(status?: number) { super('Model provider is temporarily unavailable', 'provider_unavailable', true, status); }
}

export class ProviderInvalidResponseError extends ProviderError {
  constructor() { super('Model provider returned an invalid response', 'provider_invalid_response', false); }
}
