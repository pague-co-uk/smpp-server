import { Injectable } from "@nestjs/common";

import {
  SMPP_BIND_TYPES,
  type SmppBindType,
} from "./types/smpp-bind.types.js";

@Injectable()
export class SmppBindAuthorizationService {
  public canSubmitSm(
    bindType: SmppBindType | undefined,
  ): boolean {
    return (
      bindType === SMPP_BIND_TYPES.TRANSMITTER ||
      bindType === SMPP_BIND_TYPES.TRANSCEIVER
    );
  }

  public canDeliverSm(
    bindType: SmppBindType | undefined,
  ): boolean {
    return (
      bindType === SMPP_BIND_TYPES.RECEIVER ||
      bindType === SMPP_BIND_TYPES.TRANSCEIVER
    );
  }
}