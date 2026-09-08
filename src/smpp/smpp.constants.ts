export const SMPP_SESSION_STATES = {
  CONNECTING: "CONNECTING",
  CONNECTED: "CONNECTED",
  BOUND: "BOUND",
  UNBOUND: "UNBOUND",
  CLOSED: "CLOSED",
} as const;

export type SmppSessionState =
  (typeof SMPP_SESSION_STATES)[keyof typeof SMPP_SESSION_STATES];