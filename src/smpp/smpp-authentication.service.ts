import {
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import {
  Loggers,
} from "@pague-co-uk/sms-gateway-telemetry";

import { AppConfigService } from "../config/config.service.js";

import type { SmppBindRequest } from "./types/smpp-bind.types.js";

export const SMPP_AUTH_RESULTS = {
  SUCCESS: "SUCCESS",
  INVALID_SYSTEM_ID: "INVALID_SYSTEM_ID",
  INVALID_PASSWORD: "INVALID_PASSWORD",
  ACCOUNT_DISABLED: "ACCOUNT_DISABLED",
  ACCOUNT_SUSPENDED: "ACCOUNT_SUSPENDED",
  IP_NOT_ALLOWED: "IP_NOT_ALLOWED",
} as const;

export type SmppAuthenticationResult =
  (typeof SMPP_AUTH_RESULTS)[keyof typeof SMPP_AUTH_RESULTS];

interface SmppAuthenticationApiResponse {
  readonly authenticated: boolean;
  readonly reason?:
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_DISABLED"
  | "ACCOUNT_SUSPENDED"
  | "IP_NOT_ALLOWED";
  readonly account?: {
    readonly id: string;
    readonly clientId: string;
    readonly systemId: string;
    readonly maxConcurrentBinds: number;
    readonly enquireLinkInterval: number;
  };
}

@Injectable()
export class SmppAuthenticationService {
  private readonly logger = Loggers.smpp;

  constructor(
    private readonly config: AppConfigService,
  ) { }

  public async authenticate(
    request: SmppBindRequest,
  ) {
    const remoteAddress =
      request.remoteAddress;

    try {
      const response =
        await fetch(
          `${this.config.api.baseUrl}/smpp-accounts/authenticate`,
          {
            method: "POST",

            headers: {
              "content-type":
                "application/json",
            },

            body: JSON.stringify({
              systemId:
                request.systemId,

              password:
                request.password,

              remoteAddress,
            }),
          },
        );

      if (!response.ok) {
        this.logger.error(
          {
            systemId:
              request.systemId,
            remoteAddress,
            status:
              response.status,
          },
          "SMPP authentication API request failed.",
        );

        return {
          result:
            SMPP_AUTH_RESULTS.INVALID_SYSTEM_ID,
        } as const;
      }

      const result =
        await response.json() as
        SmppAuthenticationApiResponse;

      if (result.authenticated) {
        if (!result.account) {
          this.logger.error(
            {
              systemId:
                request.systemId,
              remoteAddress,
            },
            "SMPP authentication API returned success without account details.",
          );

          throw new ServiceUnavailableException(
            "SMPP authentication service returned an invalid response.",
          );
        }

        return {
          result:
            SMPP_AUTH_RESULTS.SUCCESS,

          account:
            result.account,
        } as const;
      }

      switch (result.reason) {
        case "ACCOUNT_DISABLED":
          return {
            result:
              SMPP_AUTH_RESULTS.ACCOUNT_DISABLED,
          } as const;

        case "ACCOUNT_SUSPENDED":
          return {
            result:
              SMPP_AUTH_RESULTS.ACCOUNT_SUSPENDED,
          } as const;

        case "IP_NOT_ALLOWED":
          this.logger.warn(
            {
              systemId:
                request.systemId,
              remoteAddress,
            },
            "SMPP bind rejected: IP address not allowed.",
          );

          return {
            result:
              SMPP_AUTH_RESULTS.IP_NOT_ALLOWED,
          } as const;

        case "INVALID_CREDENTIALS":
        default:
          this.logger.warn(
            {
              systemId:
                request.systemId,
              remoteAddress,
            },
            "SMPP bind rejected: invalid credentials.",
          );

          return {
            result:
              SMPP_AUTH_RESULTS.INVALID_PASSWORD,
          } as const;
      }
    } catch (error) {
      if (
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      this.logger.error(
        {
          err: error,
          systemId:
            request.systemId,
          remoteAddress,
        },
        "Unable to contact SMPP authentication API.",
      );

      throw new ServiceUnavailableException(
        "SMPP authentication service is unavailable.",
      );
    }
  }
}