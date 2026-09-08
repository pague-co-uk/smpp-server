export const SMPP_BIND_TYPES = {
  TRANSMITTER: "TRANSMITTER",
  RECEIVER: "RECEIVER",
  TRANSCEIVER: "TRANSCEIVER",
} as const;

export type SmppBindType =
  (typeof SMPP_BIND_TYPES)[keyof typeof SMPP_BIND_TYPES];

export interface SmppBindRequest {
  readonly systemId: string;
  readonly password: string;
  readonly bindType: SmppBindType;
  readonly remoteAddress?: string;
}