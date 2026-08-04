// @ts-check

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;

/**
 * @param {"accept" | "reject"} action
 */
export function createOfferIdempotencyKey(action) {
  const key = `hospital-${action}:${crypto.randomUUID()}`;
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new TypeError("멱등성 키 형식이 올바르지 않습니다.");
  }
  return key;
}

/**
 * @param {Storage} storage
 * @param {string} offerId
 * @param {"accept" | "reject"} action
 * @param {unknown} payload
 */
export function getOrCreateOfferCommand(storage, offerId, action, payload) {
  const storageKey = `ersync-offer-command:${offerId}`;
  const fingerprint = JSON.stringify({ action, payload });

  try {
    const saved = JSON.parse(storage.getItem(storageKey) || "null");
    if (
      saved &&
      saved.fingerprint === fingerprint &&
      IDEMPOTENCY_KEY_PATTERN.test(saved.idempotencyKey)
    ) {
      return saved;
    }
  } catch {
    storage.removeItem(storageKey);
  }

  const command = {
    action,
    payload,
    fingerprint,
    idempotencyKey: createOfferIdempotencyKey(action),
  };
  storage.setItem(storageKey, JSON.stringify(command));
  return command;
}

/**
 * @param {Storage} storage
 * @param {string} offerId
 * @param {string} idempotencyKey
 */
export function clearOfferCommand(storage, offerId, idempotencyKey) {
  const storageKey = `ersync-offer-command:${offerId}`;
  try {
    const saved = JSON.parse(storage.getItem(storageKey) || "null");
    if (!saved || saved.idempotencyKey === idempotencyKey) {
      storage.removeItem(storageKey);
    }
  } catch {
    storage.removeItem(storageKey);
  }
}
