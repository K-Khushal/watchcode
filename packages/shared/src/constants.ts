export const DAEMON_PORT = 9876;
export const DAEMON_HOST = "127.0.0.1";

export const HOOK_TIMEOUT_SECONDS = 259200;
export const HOOK_POLL_INTERVAL_MS = 1000;
export const HOOK_TRANSCRIPT_DELTA_BYTES = 100;
export const HOOK_LONGPOLL_TIMEOUT_MS = 25_000;

export const PROTOCOL_VERSION = 1;

// Slice 4 — security
export const PAIRING_WINDOW_MS = 60_000;
export const SECRET_BYTES = 32;
export const WS_HELLO_TIMEOUT_MS = 5_000;
export const WS_CLOSE_UNAUTHENTICATED = 4001;
export const MDNS_SERVICE_TYPE = "_watchcode._tcp";
