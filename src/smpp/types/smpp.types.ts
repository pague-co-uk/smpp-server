
import type { SmppSessionState } from "../smpp.constants.js";

export interface SmppSessionInfo {
  readonly sessionId: string;
  readonly state: SmppSessionState;
  readonly systemId?: string;
  readonly remoteAddress?: string;
  readonly remotePort?: number;
}

export interface SmppSessionEvents {
  readonly close: () => void;
  readonly error: (error: Error) => void;
}