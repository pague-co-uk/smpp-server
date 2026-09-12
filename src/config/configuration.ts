export default () => ({
  // ===========================================================================
  // Application
  // ===========================================================================

  app: {
    name:
      process.env.APP_NAME ??
      "smpp-server",

    version:
      process.env.APP_VERSION ??
      "1.0.0",

    environment:
      process.env.NODE_ENV ??
      "development",

    host:
      process.env.APP_HOST ??
      "0.0.0.0",

    port:
      Number.parseInt(
        process.env.APP_PORT ??
        "9005",
        10,
      ),
  },

  // ===========================================================================
  // API
  // ===========================================================================

  api: {
    prefix:
      process.env.API_PREFIX ??
      "",

    baseUrl:
      process.env.CONTROL_PLANE_API_BASE_URL ??
      "",
    apiKey:
      process.env.MESSAGING_API_KEY ?? "",
  },

  // ===========================================================================
  // Telemetry
  // ===========================================================================

  telemetry: {
    enabled:
      process.env.OTEL_ENABLED !==
      "false",

    serviceName:
      process.env.OTEL_SERVICE_NAME ??
      process.env.APP_NAME ??
      "smpp-server",

    serviceVersion:
      process.env.OTEL_SERVICE_VERSION ??
      process.env.APP_VERSION ??
      "1.0.0",

    tracesEndpoint:
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
      "http://localhost:4318/v1/traces",

    metricsEndpoint:
      process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ??
      "http://localhost:4318/v1/metrics",

    logsEndpoint:
      process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ??
      "http://localhost:4318/v1/logs",

    exportIntervalMillis:
      Number.parseInt(
        process.env.OTEL_METRIC_EXPORT_INTERVAL ??
        "60000",
        10,
      ),

    disableFsInstrumentation:
      process.env.OTEL_DISABLE_FS_INSTRUMENTATION ===
      "true",
  },

  // ===========================================================================
  // Logging
  // ===========================================================================

  log: {
    level:
      process.env.LOG_LEVEL ??
      "info",

    stdout:
      process.env.LOG_STDOUT !==
      "false",

    file: {
      enabled:
        process.env.LOG_FILE ===
        "true",

      path:
        process.env.LOG_FILE_PATH ??
        "./logs/smpp-server.log",
    },
  },

  // ===========================================================================
  // SMPP
  // ===========================================================================

  smpp: {
    host:
      process.env.SMPP_HOST ??
      "0.0.0.0",

    port:
      Number.parseInt(
        process.env.SMPP_PORT ??
        "2775",
        10,
      ),

    maxSessions:
      Number.parseInt(
        process.env.SMPP_MAX_SESSIONS ??
        "1000",
        10,
      ),

    enquireLinkIntervalMs:
      Number.parseInt(
        process.env.SMPP_ENQUIRE_LINK_INTERVAL_MS ??
        "30000",
        10,
      ),

    sessionTimeoutMs:
      Number.parseInt(
        process.env.SMPP_SESSION_TIMEOUT_MS ??
        "60000",
        10,
      ),
  },

});