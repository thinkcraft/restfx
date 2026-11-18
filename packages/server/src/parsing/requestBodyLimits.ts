export const DEFAULT_MAX_REQUEST_BODY_BYTES = 1_048_576;

export function validateMaxRequestBodyBytes(
  maxBytes: number,
  optionName = "maxRequestBodyBytes",
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError(`${optionName} must be a non-negative safe integer`);
  }
}
