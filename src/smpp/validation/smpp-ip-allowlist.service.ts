import { Injectable } from "@nestjs/common";

import { normalizeIpAddress } from "./smpp-ip.util.js";

@Injectable()
export class SmppIpAllowlistService {
  public isAllowed(
    remoteAddress: string | undefined,
    allowedAddresses: readonly string[],
  ): boolean {
    const normalizedRemoteAddress =
      normalizeIpAddress(remoteAddress);

    if (!normalizedRemoteAddress) {
      return false;
    }

    if (allowedAddresses.length === 0) {
      return false;
    }

    return allowedAddresses.some(
      (address) =>
        normalizeIpAddress(address) ===
        normalizedRemoteAddress,
    );
  }
}