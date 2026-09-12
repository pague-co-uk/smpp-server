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

interface SmppAuthenticationApiEnvelope {
  readonly success: boolean;

  readonly data: SmppAuthenticationApiResponse;

  readonly meta?: {
    readonly requestId?: string;
    readonly timestamp?: string;
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

    const url =
      `${this.config.api.baseUrl}/smpp-accounts/authenticate`;

    this.logger.info(
      {
        systemId:
          request.systemId,

        remoteAddress,

        url,
      },
      "Sending SMPP authentication request to Control Plane API.",
    );

    try {
      const response =
        await fetch(
          url,
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

      let responseBody:
        | SmppAuthenticationApiEnvelope
        | undefined;

      try {
        responseBody =
          await response.json() as
          SmppAuthenticationApiEnvelope;
      } catch (error) {
        this.logger.error(
          {
            err:
              error,

            systemId:
              request.systemId,

            remoteAddress,

            status:
              response.status,
          },
          "SMPP authentication API returned invalid JSON.",
        );

        throw new ServiceUnavailableException(
          "SMPP authentication service returned an invalid response.",
        );
      }

      this.logger.info(
        {
          systemId:
            request.systemId,

          remoteAddress,

          status:
            response.status,

          ok:
            response.ok,

          response:
            responseBody,
        },
        "Received SMPP authentication API response.",
      );

      if (!response.ok) {
        this.logger.error(
          {
            systemId:
              request.systemId,

            remoteAddress,

            status:
              response.status,

            response:
              responseBody,
          },
          "SMPP authentication API request failed.",
        );

        throw new ServiceUnavailableException(
          "SMPP authentication service is unavailable.",
        );
      }

      if (
        !responseBody ||
        !responseBody.data
      ) {
        this.logger.error(
          {
            systemId:
              request.systemId,

            remoteAddress,

            response:
              responseBody,
          },
          "SMPP authentication API returned an invalid response.",
        );

        throw new ServiceUnavailableException(
          "SMPP authentication service returned an invalid response.",
        );
      }

      const result =
        responseBody.data;

      this.logger.info(
        {
          systemId:
            request.systemId,

          remoteAddress,

          authenticated:
            result.authenticated,

          reason:
            result.reason,

          accountId:
            result.account?.id,

          clientId:
            result.account?.clientId,

          accountSystemId:
            result.account?.systemId,

          maxConcurrentBinds:
            result.account?.maxConcurrentBinds,

          enquireLinkInterval:
            result.account?.enquireLinkInterval,
        },
        "Parsed SMPP authentication result.",
      );

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

        this.logger.info(
          {
            systemId:
              request.systemId,

            remoteAddress,

            accountId:
              result.account.id,

            clientId:
              result.account.clientId,

            maxConcurrentBinds:
              result.account.maxConcurrentBinds,

            enquireLinkInterval:
              result.account.enquireLinkInterval,
          },
          "SMPP authentication successful.",
        );

        return {
          result:
            SMPP_AUTH_RESULTS.SUCCESS,

          account:
            result.account,
        } as const;
      }

      switch (result.reason) {
        case "ACCOUNT_DISABLED":
          this.logger.warn(
            {
              systemId:
                request.systemId,

              remoteAddress,
            },
            "SMPP bind rejected: account disabled.",
          );

          return {
            result:
              SMPP_AUTH_RESULTS.ACCOUNT_DISABLED,
          } as const;

        case "ACCOUNT_SUSPENDED":
          this.logger.warn(
            {
              systemId:
                request.systemId,

              remoteAddress,
            },
            "SMPP bind rejected: account suspended.",
          );

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

              reason:
                result.reason,
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
        error instanceof
        ServiceUnavailableException
      ) {
        throw error;
      }

      this.logger.error(
        {
          err:
            error,

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