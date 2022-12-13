import { BatchSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import * as opentelemetry from '@opentelemetry/sdk-node';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { AwsInstrumentation } from 'opentelemetry-instrumentation-aws-sdk';
import { AWSXRayIdGenerator } from '@opentelemetry/id-generator-aws-xray';
import { trace } from '@opentelemetry/api';
import { AWSXRayPropagator } from '@opentelemetry/propagator-aws-xray';

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
      [SemanticResourceAttributes.SERVICE_NAME]: 'harmonny-service',
      [SemanticResourceAttributes.SERVICE_VERSION]: '0.1.0',
    }),
  );

const provider = new NodeTracerProvider({
  resource: resource,
  idGenerator: new AWSXRayIdGenerator(),

});
// const exporter = new ConsoleSpanExporter();
const otlpExporter = new OTLPTraceExporter({
  // port configured in the Collector config, defaults to 4317
  url: 'http://localhost:4318/v1/traces',
});
// provider.addSpanProcessor(new BatchSpanProcessor(otlpExporter));
const processor = new BatchSpanProcessor(otlpExporter);
provider.addSpanProcessor(processor);

//provider.register();
provider.register({
  propagator: new AWSXRayPropagator(),
});
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const tracer = trace.getTracer('sample-instrumentation');

// const sdk = new opentelemetry.NodeSDK({
//   traceExporter: otlpExporter,
//   instrumentations:  [
//     getNodeAutoInstrumentations(),
//     new HttpInstrumentation(),
//     // new AwsInstrumentation({
//     //   suppressInternalInstrumentation: true,
//     // })
//   ],
// });

// // eslint-disable-next-line @typescript-eslint/no-floating-promises
// sdk.start();


const sdk = new opentelemetry.NodeSDK({
  // traceExporter: new OTLPTraceExporter({
  //   // optional - default url is http://localhost:4318/v1/traces
  //   url: 'http://localhost:4318/v1/traces',
  //   // optional - collection of custom headers to be sent with each request, empty by default
  //   headers: {},
  // }),
  traceExporter: new ConsoleSpanExporter(),
  instrumentations: [getNodeAutoInstrumentations(), new HttpInstrumentation()],
});
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
sdk.start();
// export const sdk = new opentelemetry.NodeSDK({
//   traceExporter: new OTLPTraceExporter({
//     // optional - default url is http://localhost:4318/v1/traces
//     url: 'http://localhost:4318/v1/traces',
//     // optional - collection of custom headers to be sent with each request, empty by default
//     headers: {},
//   }),
//   instrumentations: [getNodeAutoInstrumentations()],
// });
// // eslint-disable-next-line @typescript-eslint/no-floating-promises
// sdk.start();

// // import * as opentelemetry from '@opentelemetry/sdk-node';
// // import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
// import { diag, DiagConsoleLogger, DiagLogLevel, trace, Tracer } from '@opentelemetry/api';
// import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
// import { AWSXRayIdGenerator } from '@opentelemetry/id-generator-aws-xray';
// import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
// import { AWSXRayPropagator } from '@opentelemetry/propagator-aws-xray';
// import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
// // import { Resource } from '@opentelemetry/resources';
// // import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

// /**
//  *
//  * @returns stuff
//  */
// export function getTracer(): Tracer {
//   // For troubleshooting, set the log level to DiagLogLevel.DEBUG
//   diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

//   const tracerConfig = {
//     idGenerator: new AWSXRayIdGenerator(),
//     // any instrumentations can be declared here
//     instrumentations: [getNodeAutoInstrumentations()],
//     // any resources can be declared here
//     //   resource: Resource.default().merge(new Resource({
//     //     [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
//     //   })),
//   };

//   const tracerProvider = new NodeTracerProvider(tracerConfig);

//   const otlpExporter = new OTLPTraceExporter({
//     // port configured in the Collector config, defaults to 4317
//     url: 'localhost:4317',
//   });
//   tracerProvider.addSpanProcessor(new BatchSpanProcessor(otlpExporter));

//   // Register the tracer provider with an X-Ray propagator
//   tracerProvider.register({
//     propagator: new AWSXRayPropagator(),
//   });

//   // Return an tracer instance
//   return trace.getTracer('sample-instrumentation');
// }



// // const sdk = new opentelemetry.NodeSDK({
// //   traceExporter: new OTLPTraceExporter({
// //     // optional - default url is http://localhost:4318/v1/traces
// //     url: 'localhost:4317',
// //   }),
// //   instrumentations: [getNodeAutoInstrumentations()],
// // });

// // // const sdk = new opentelemetry.NodeSDK({
// // //   traceExporter: new opentelemetry.tracing.ConsoleSpanExporter(),
// // //   instrumentations: [getNodeAutoInstrumentations()],
// // // });

// // // eslint-disable-next-line @typescript-eslint/no-floating-promises
// // sdk.start();