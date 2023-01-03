import { BatchSpanProcessor, SamplingDecision, SamplingResult } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { AWSXRayIdGenerator } from '@opentelemetry/id-generator-aws-xray';
import { Attributes, Context, Link, SpanKind, trace } from '@opentelemetry/api';
import { AWSXRayPropagator } from '@opentelemetry/propagator-aws-xray';
import env from './util/env';
import { random } from 'lodash';
import { AwsInstrumentation } from '@opentelemetry/instrumentation-aws-sdk';

// Register instrumentation libraries for Node.js auto-instrumentation and capturing of
// outgoing HTTP calls
registerInstrumentations({
  instrumentations: [
    getNodeAutoInstrumentations(),
    new HttpInstrumentation(),
    new AwsInstrumentation({}),
  ],
});

const resource =
  Resource.default().merge(
    new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: env.harmonyClientId,
      [SemanticResourceAttributes.SERVICE_VERSION]: '0.1.0',
    }),
  );
interface SampleCheckContext {
  context?: Context,
  traceId?: string,
  spanName?: string,
  spanKind?: SpanKind,
  attributes?: Attributes,
  links?: Link[],
}

/**
 * Test function that checks a single criteria to see if we want to sample a given trace/span
 * @param context - the context of the trace to be (or not to be) sampled
 */
type _SampleCheckFn = (context: SampleCheckContext) => SamplingDecision;

const ELB_HEALTH_CHECK_AGENT = 'ELB-HealthChecker/2.0';

/**
 * {@inheritDoc SampleCheckFn}
 */
function ignoreHealthCheck(context: SampleCheckContext): SamplingDecision {
  let decision: SamplingDecision;
  if (context.attributes['http.user_agent'] === ELB_HEALTH_CHECK_AGENT) {
    decision = SamplingDecision.NOT_RECORD;
  }
  return decision;
}

/**
 * {@inheritDoc SampleCheckFn}
 */
function ignoreGetMetrics(context: SampleCheckContext): SamplingDecision {
  let decision: SamplingDecision;
  if (context.attributes['http.target'] === '/service/metrics') {
    decision = SamplingDecision.NOT_RECORD;
  }
  return decision;
}

/**
 * {@inheritDoc SampleCheckFn}
 */
function throttleWorkRequestTraces(context: SampleCheckContext): SamplingDecision {
  let decision: SamplingDecision;
  const target = context.attributes['http.target'];
  if (target && target.toString().startsWith('/service/work')) {
    let ratio = env.putWorkSampleRatio;
    if (context.attributes['http.method'].toString().toUpperCase() === 'GET') {
      ratio = env.getWorkSampleRatio;
    }
    if (random(true) > ratio) {
      decision =  SamplingDecision.NOT_RECORD;
    } else {
      decision = SamplingDecision.RECORD_AND_SAMPLED;
    }
  }
  return decision;
}

/**
 * {@inheritDoc SampleCheckFn}
 */
function ignoreFileSystemCalls(context: SampleCheckContext): SamplingDecision {
  let decision: SamplingDecision;
  if (context.spanName.startsWith('fs ')) {
    decision = SamplingDecision.NOT_RECORD;
  }
  return decision;
}

/**
 * Given a ton of context decide whether or not to send a given span for a trace to the
 * OpenTelemetry collector
 *
 * @param context - The context for the trace (not particularly useful for us)
 * @param traceId - The ID of the trace as seen in the X-Ray console
 * @param spanName - The name of the span (spans make up traces). Sometimes useful for filtering.
 * @param spanKind - The type of span - always seems to be 0
 * @param attributes - Searchable annotations added (automatically or manually) to traces. For
 * us this is very useful as the auto-instrumentation adds things like the url, the http action,
 * etc.
 * @param links - not sure what this is
 * @returns An indication of whether or not to record the sample.
 */
function shouldSample(
  context: Context,
  traceId: string,
  spanName: string,
  spanKind: SpanKind,
  attributes: Attributes,
  links: Link[],
): SamplingResult {

  const combinedContext = {
    context,
    traceId,
    spanName,
    spanKind,
    attributes,
    links,
  };

  // Look for any of our checks that require or deny sampling - default to requiring
  // sampling if none of the checks apply, i.e., in all other cases we sample
  let decision = SamplingDecision.RECORD_AND_SAMPLED;
  const checks = [
    ignoreFileSystemCalls,
    ignoreHealthCheck,
    ignoreGetMetrics,
    throttleWorkRequestTraces];

  for (const check of checks) {
    const checkResult = check(combinedContext);
    if (checkResult != undefined) {
      decision = checkResult;
      break;
    }
  }

  return {
    decision,
  };
}

const provider = new NodeTracerProvider({
  resource: resource,
  idGenerator: new AWSXRayIdGenerator(),
  sampler: {
    shouldSample,
  },
});

const exporter = new OTLPTraceExporter({
  url: env.openTelemetryUrl,
});

const processor = new BatchSpanProcessor(exporter);

provider.addSpanProcessor(processor);
provider.register({
  propagator: new AWSXRayPropagator(),
});

trace.getTracer('sample-instrumentation');
