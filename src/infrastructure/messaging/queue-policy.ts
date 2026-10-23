// Broker e consumidor precisam concordar sobre os limites de entrega e visibilidade.
export const MAX_DELIVERY_ATTEMPTS = 5;
export const MESSAGE_VISIBILITY_SECONDS = 30;
export const VISIBILITY_HEARTBEAT_MS = 10_000;
export const MAX_DELIVERY_BACKOFF_SECONDS = 60;
