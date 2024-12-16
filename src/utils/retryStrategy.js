const { RETRY_COUNT, RETRY_DELAY } = require('../config');
const { errorHandler } = require('./errorHandler');

// Error types untuk different handling
const ErrorType = {
  NETWORK: 'NETWORK',
  RATE_LIMIT: 'RATE_LIMIT',
  SERVER: 'SERVER',
  PARSE: 'PARSE',
  UNKNOWN: 'UNKNOWN'
};

// Classify error type
function classifyError(error) {
  if (!error.response) {
    return ErrorType.NETWORK;
  }

  const status = error.response.status;
  if (status === 429) {
    return ErrorType.RATE_LIMIT;
  }
  if (status >= 500) {
    return ErrorType.SERVER;
  }
  if (error.message.includes('JSON')) {
    return ErrorType.PARSE;
  }

  return ErrorType.UNKNOWN;
}

// Calculate delay based on error type and attempt
function calculateDelay(errorType, attempt) {
  const baseDelay = RETRY_DELAY;

  switch (errorType) {
    case ErrorType.NETWORK:
      // Network errors: exponential backoff
      return Math.min(baseDelay * Math.pow(2, attempt), 30000);

    case ErrorType.RATE_LIMIT:
      // Rate limit: longer delays
      return Math.min(baseDelay * Math.pow(3, attempt), 60000);

    case ErrorType.SERVER:
      // Server errors: moderate delays
      return Math.min(baseDelay * Math.pow(1.5, attempt), 15000);

    default:
      // Default exponential backoff
      return Math.min(baseDelay * Math.pow(2, attempt), 20000);
  }
}

// Main retry function
async function withRetry(operation, context = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < RETRY_COUNT; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const errorType = classifyError(error);
      const delay = calculateDelay(errorType, attempt);

      // Log retry attempt with context
      await errorHandler(
        `Retry attempt ${attempt + 1}/${RETRY_COUNT}`,
        {
          error: error.message,
          type: errorType,
          delay,
          context
        }
      );

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // If all retries failed
  throw lastError;
}

module.exports = {
  withRetry,
  ErrorType,
  classifyError
};
