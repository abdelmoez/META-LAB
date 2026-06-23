/**
 * pecanSearch/connectors/registry.js — assembles the engine context: resolved
 * config + a shared hardened HTTP client + the per-provider connector instances.
 *
 * Connectors are added here as they are implemented. Each is constructed with the
 * SAME injected deps (http/now/sleep/logger/contact) so behavior is uniform and
 * the whole engine is testable with a mock fetch + fixed clock.
 *
 * createEngineContext(env, settings, overrides) is the one entry point the
 * controller, worker, and tests use.
 */
import { loadPecanConfig, configSecrets, PROVIDER_IDS } from '../config.js';
import { createHttpClient } from '../httpClient.js';
import { createPubmedConnector } from './pubmed.js';

/**
 * Factory map: providerId → (providerConfig, deps) => Connector.
 * Additional providers (europepmc, clinicaltrials, crossref, doaj, openalex,
 * semanticscholar) register here as they are implemented against the contract.
 */
export const CONNECTOR_FACTORIES = {
  pubmed: createPubmedConnector,
};

/**
 * createEngineContext(env, settings, overrides)
 * @param {object} env       process.env
 * @param {object} settings  parsed `searchProviderSettings` SiteSetting block
 * @param {object} overrides { fetch, now, sleep, random, logger } (DI for tests)
 * @returns {{ config, http, connectors, contact, listProviders() }}
 */
export function createEngineContext(env = process.env, settings = {}, overrides = {}) {
  const config = loadPecanConfig(env, settings);
  const secrets = configSecrets(config);
  const http = createHttpClient({
    fetch: overrides.fetch,
    now: overrides.now,
    sleep: overrides.sleep,
    random: overrides.random,
    logger: overrides.logger,
    secrets,
  });

  const deps = {
    http,
    now: overrides.now || (() => Date.now()),
    sleep: overrides.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))),
    logger: overrides.logger || { debug() {}, warn(...a) { console.warn(...a); } },
    contact: config.contact,
    retryLimit: config.engine.retryLimit,
  };

  const connectors = {};
  for (const id of PROVIDER_IDS) {
    const factory = CONNECTOR_FACTORIES[id];
    if (!factory) continue; // not yet implemented — provider reported as unavailable
    connectors[id] = factory(config.providers[id], deps);
  }

  return {
    config,
    http,
    connectors,
    contact: config.contact,
    /** A provider is selectable iff it has a connector AND is enabled+configured. */
    listProviders() {
      return PROVIDER_IDS.map((id) => {
        const p = config.providers[id];
        const implemented = !!CONNECTOR_FACTORIES[id];
        return {
          ...p,
          implemented,
          selectable: implemented && p.available,
          apiKey: undefined, // never leak
        };
      });
    },
  };
}

/** Convenience: does a provider have a working connector implementation? */
export function isProviderImplemented(id) { return !!CONNECTOR_FACTORIES[id]; }
