# Procedures for Maintaining a Harmony Kubernetes Cluster

This document provides instructions for the ongoing maintenance of a running Harmony cluster.

## Monitoring

Monitoring a running Harmony cluster is done using a combination of custom logging 
(sent to CloudWatch when run on AWS) and the tools described here.

### Prometheus

The `deploy-prometheus` script in  the `bin` directory of this repository can be used to deploy
[Prometheus](https://prometheus.io/) into the Harmony Kubernetes cluster along with the 
[kube-state-metrics](https://github.com/kubernetes/kube-state-metrics) service which provides 
useful metrics related to pods and the state of the cluster. The Prometheus UI can be accessed
by forwarding the service's port (9090) to a local machine as follows (all `kubectl` commands
listed in this document use either the default context or the one specified by the optional
`--kubeconfig` paramter):

1. get the pod identifier for Prometheus
```
kubectl get pods -n monitoring [--kubeconfig <config file>]
```
2. forward port `9090` from the pod to your local machine
```
kubectl port-forward <Prometheus Pod ID> 9090:9090 -n monitoring [--kubeconfig <config file>]
```

After which you can access the Prometheus UI in web browser at `http://localhost:9090`.

#### Metrics

Harmony services workers provide a [metric](https://prometheus.io/docs/concepts/data_model/) 
that is scraped by Prometheus, `num_ready_work_items`, which is the number of work items for a 
given service that are in the 'READY' state (i.e., available to be worked but not yet being worked).
It can be accessed via the Prometheus UI.

Harmony deploys the [Prometheus Adapter](https://github.com/kubernetes-sigs/prometheus-adapter)
to make this metric available to the [Horizontal Pod Autoscaler (HPA)](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
to scale the number of pods for a given service up or down in response to load.

#### Monitoring the Number of Pods for Each Service

The following Prometheus query (promQL) can be used to get the current number of running pods
for each deployed service.

```
sum(
count(kube_pod_status_phase{phase="Running", namespace="harmony"}) by (pod)
*
on (pod) group_left(label_name) sum (kube_pod_labels{namespace="harmony",label_name=~".*"}) without (namespace)
) by (label_name)
```

The `".*"` for the `label_name` can be replaced with a service name to get the count for just that 
service, e.g, `"harmony-service-example"`.