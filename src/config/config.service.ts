import {
  Injectable,
} from "@nestjs/common";

import {
  ConfigService,
} from "@nestjs/config";

@Injectable()
export class AppConfigService {
  constructor(
    private readonly config:
      ConfigService,
  ) { }

  // =========================================================================
  // Application
  // =========================================================================

  get app() {
    return {
      name:
        this.config.getOrThrow<string>(
          "app.name",
        ),

      version:
        this.config.getOrThrow<string>(
          "app.version",
        ),

      environment:
        this.config.getOrThrow<string>(
          "app.environment",
        ),

      host:
        this.config.getOrThrow<string>(
          "app.host",
        ),

      port:
        this.config.getOrThrow<number>(
          "app.port",
        ),
    };
  }

  // =========================================================================
  // API
  // =========================================================================

  get api() {
    return {
      prefix:
        this.config.getOrThrow<string>(
          "api.prefix",
        ),
      baseUrl: this.config.getOrThrow<string>("api.baseUrl")
    };
  }

  // =========================================================================
  // Authentication / Security
  // =========================================================================

  get auth() {
    return {
      security: {
        secretHashKey:
          this.config.getOrThrow<string>(
            "auth.security.secretHashKey",
          ),
      },
    };
  }

  // =========================================================================
  // Telemetry
  // =========================================================================

  get telemetry() {
    return {
      enabled:
        this.config.getOrThrow<boolean>(
          "telemetry.enabled",
        ),

      serviceName:
        this.config.getOrThrow<string>(
          "telemetry.serviceName",
        ),

      serviceVersion:
        this.config.getOrThrow<string>(
          "telemetry.serviceVersion",
        ),

      tracesEndpoint:
        this.config.getOrThrow<string>(
          "telemetry.tracesEndpoint",
        ),

      metricsEndpoint:
        this.config.getOrThrow<string>(
          "telemetry.metricsEndpoint",
        ),

      logsEndpoint:
        this.config.getOrThrow<string>(
          "telemetry.logsEndpoint",
        ),

      exportIntervalMillis:
        this.config.getOrThrow<number>(
          "telemetry.exportIntervalMillis",
        ),

      disableFsInstrumentation:
        this.config.getOrThrow<boolean>(
          "telemetry.disableFsInstrumentation",
        ),
    };
  }
  // =========================================================================
  // Logging
  // =========================================================================

  get log() {
    return {
      level:
        this.config.getOrThrow<string>(
          "log.level",
        ),

      stdout:
        this.config.getOrThrow<boolean>(
          "log.stdout",
        ),

      file:
        this.config.getOrThrow<{
          enabled: boolean;
          path: string;
        }>(
          "log.file",
        ),
    };
  }

  // =========================================================================
  // SMPP
  // =========================================================================

  get smpp() {
    return {
      host:
        this.config.getOrThrow<string>(
          "smpp.host",
        ),

      port:
        this.config.getOrThrow<number>(
          "smpp.port",
        ),

      maxSessions:
        this.config.getOrThrow<number>(
          "smpp.maxSessions",
        ),

      enquireLinkIntervalMs:
        this.config.getOrThrow<number>(
          "smpp.enquireLinkIntervalMs",
        ),

      sessionTimeoutMs:
        this.config.getOrThrow<number>(
          "smpp.sessionTimeoutMs",
        ),
    };
  }
}