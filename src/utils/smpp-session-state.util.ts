import { SMPP_SESSION_STATES, SmppSessionState } from "../smpp/smpp.constants.js";


export type TelemetrySmppSessionState = 'connecting' | 'connected' | 'bound' | 'unbound' | 'closing' | 'closed';

export function toTelemetrySmppSessionState(
  state: SmppSessionState,
): TelemetrySmppSessionState {
  switch (state) {
    case SMPP_SESSION_STATES.CONNECTING:
      return "connecting";

    case SMPP_SESSION_STATES.CONNECTED:
      return "connected";

    case SMPP_SESSION_STATES.BOUND:
      return "bound";

    case SMPP_SESSION_STATES.UNBOUND:
      return "unbound";

    case SMPP_SESSION_STATES.CLOSED:
      return "closed";

    default:
      throw new Error(
        `Unsupported SMPP session state: ${state}`,
      );
  }
}