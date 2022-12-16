import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { AWSXRayIdGenerator } from '@opentelemetry/id-generator-aws-xray';
import { trace } from '@opentelemetry/api';
import { AWSXRayPropagator } from '@opentelemetry/propagator-aws-xray';
import env from './util/env';

// Optionally register instrumentation libraries
registerInstrumentations({
  instrumentations: [
    getNodeAutoInstrumentations(),
    new HttpInstrumentation(),
  ],
});

const resource =
  Resource.default().merge(
    new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: env.harmonyClientId,
      [SemanticResourceAttributes.SERVICE_VERSION]: '0.1.0',
    }),
  );

const provider = new NodeTracerProvider({
  resource: resource,
  idGenerator: new AWSXRayIdGenerator(),

});
const otlpExporter = new OTLPTraceExporter({
  // port configured in the Collector config, defaults to 4317
  url: 'http://localhost:4318/v1/traces',
});
const processor = new BatchSpanProcessor(otlpExporter);
provider.addSpanProcessor(processor);

provider.register({
  propagator: new AWSXRayPropagator(),
});
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const tracer = trace.getTracer('sample-instrumentation');
