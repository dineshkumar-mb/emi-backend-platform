import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { SimpleSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

// Optional: Set diagnostic logger for OpenTelemetry troubleshooting to error only to avoid spam
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

// Define a console exporter so it doesn't default to OTLP collector on port 4318
const traceExporter = new ConsoleSpanExporter();

const sdk = new NodeSDK({
  serviceName: 'mitr-ai-backend',
  traceExporter: traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': {
        enabled: false,
      },
    }),
  ],
});

// Start SDK and register lifecycle handlers
try {
  // sdk.start();
  console.log('🔭 OpenTelemetry initialized with Console Exporter (DISABLED to prevent crashes).');
} catch (error) {
  console.error('❌ Failed to initialize OpenTelemetry:', error);
}

// process.on('SIGTERM', () => {
//   sdk.shutdown()
//     .then(() => console.log('🔭 OpenTelemetry tracing terminated.'))
//     .catch((error) => console.error('❌ Error terminating OpenTelemetry:', error))
//     .finally(() => process.exit(0));
// });

export default sdk;
