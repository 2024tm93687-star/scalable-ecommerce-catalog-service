const client = require('prom-client');

client.collectDefaultMetrics();

const pricingResolveLatencyMs = new client.Histogram({
  name: 'catalog_pricing_resolve_latency_ms',
  help: 'Latency for pricing resolve API in milliseconds',
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000]
});

module.exports = {
  register: client.register,
  pricingResolveLatencyMs
};
