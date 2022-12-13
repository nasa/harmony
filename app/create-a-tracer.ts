/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may not use this file except in compliance with the License.
 * A copy of the License is located at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * or in the "license" file accompanying this file. This file is distributed
 * on an "AS IS'" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 *
 */

// OTel JS - API
import { trace } from '@opentelemetry/api';

// OTel JS - Core
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

// OTel JS - Core - Exporters
import { CollectorTraceExporter } from '@opentelemetry/exporter-collector-grpc';

// OTel JS - Core - Instrumentations
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { AwsInstrumentation } from 'opentelemetry-instrumentation-aws-sdk';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

// OTel JS - Contrib - AWS X-Ray
import { AWSXRayIdGenerator } from '@opentelemetry/id-generator-aws-xray';
import { AWSXRayPropagator } from '@opentelemetry/propagator-aws-xray';

const tracerProvider = new NodeTracerProvider({
  resource: Resource.default().merge(new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'aws-otel-integ-test',
  })),
  idGenerator: new AWSXRayIdGenerator(),
  // instrumentations: [
  //   new HttpInstrumentation(),
  //   new AwsInstrumentation({
  //     suppressInternalInstrumentation: true,
  //   }),
  // ],
});

// Expects Collector at env variable `OTEL_EXPORTER_OTLP_ENDPOINT`, otherwise, http://localhost:4317
tracerProvider.addSpanProcessor(new SimpleSpanProcessor(new CollectorTraceExporter()));

tracerProvider.register({
  propagator: new AWSXRayPropagator(),
});

module.exports = trace.getTracer('awsxray-tests');
