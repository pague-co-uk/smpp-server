import Joi from "joi";

export const configValidationSchema =
  Joi.object({
    // =========================================================================
    // Application
    // =========================================================================

    NODE_ENV:
      Joi.string()
        .valid(
          "development",
          "test",
          "production",
        )
        .default("development"),

    APP_NAME:
      Joi.string()
        .default("smpp-server"),

    APP_VERSION:
      Joi.string()
        .default("1.0.0"),

    APP_HOST:
      Joi.string()
        .default("0.0.0.0"),

    APP_PORT:
      Joi.number()
        .integer()
        .min(1)
        .max(65535)
        .default(9005),

    // =========================================================================
    // API
    // =========================================================================

    API_PREFIX:
      Joi.string()
        .default(""),

    CONTROL_PLANE_API_BASE_URL:
      Joi.string()
        .uri({
          scheme: [
            "http",
            "https",
          ],
        })
        .custom(
          (value: string) =>
            value.replace(
              /\/+$/,
              "",
            ),
        )
        .required(),

    // =========================================================================
    // SMPP
    // =========================================================================

    SMPP_HOST:
      Joi.string()
        .default("0.0.0.0"),

    SMPP_PORT:
      Joi.number()
        .integer()
        .min(1)
        .max(65535)
        .default(2775),

    SMPP_MAX_SESSIONS:
      Joi.number()
        .integer()
        .min(1)
        .default(1000),

    SMPP_ENQUIRE_LINK_INTERVAL_MS:
      Joi.number()
        .integer()
        .min(1000)
        .default(30000),

    SMPP_SESSION_TIMEOUT_MS:
      Joi.number()
        .integer()
        .min(1000)
        .default(60000),

    // =========================================================================
    // Logging
    // =========================================================================

    LOG_LEVEL:
      Joi.string()
        .valid(
          "trace",
          "debug",
          "info",
          "warn",
          "error",
          "fatal",
        )
        .default("info"),

    LOG_STDOUT:
      Joi.boolean()
        .truthy(
          "true",
          "1",
        )
        .falsy(
          "false",
          "0",
        )
        .default(true),

    LOG_FILE:
      Joi.boolean()
        .truthy(
          "true",
          "1",
        )
        .falsy(
          "false",
          "0",
        )
        .default(false),

    LOG_FILE_PATH:
      Joi.string()
        .default(
          "./logs/smpp-server.log",
        ),

    // =========================================================================
    // OpenTelemetry
    // =========================================================================

    OTEL_ENABLED:
      Joi.boolean()
        .truthy(
          "true",
          "1",
        )
        .falsy(
          "false",
          "0",
        )
        .default(true),

    OTEL_SERVICE_NAME:
      Joi.string()
        .default("smpp-server"),

    OTEL_SERVICE_VERSION:
      Joi.string()
        .default("1.0.0"),

    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
      Joi.string()
        .allow("")
        .default(
          "http://localhost:4318/v1/traces",
        ),

    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:
      Joi.string()
        .allow("")
        .default(
          "http://localhost:4318/v1/metrics",
        ),

    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT:
      Joi.string()
        .allow("")
        .default(
          "http://localhost:4318/v1/logs",
        ),

    OTEL_METRIC_EXPORT_INTERVAL:
      Joi.number()
        .integer()
        .min(100)
        .default(60000),

    OTEL_DISABLE_FS_INSTRUMENTATION:
      Joi.boolean()
        .truthy(
          "true",
          "1",
        )
        .falsy(
          "false",
          "0",
        )
        .default(false),
  });