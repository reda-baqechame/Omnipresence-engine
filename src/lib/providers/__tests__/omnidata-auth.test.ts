import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  assertOmniDataClientConfigured,
  isRemoteOmniDataUrl,
  OMNIDATA_DEV_KEY,
  resolveOmniDataApiKey,
} from "../omnidata-auth.ts";

const env = process.env;

describe("omnidata-auth", () => {
  beforeEach(() => {
    process.env = { ...env };
  });
  afterEach(() => {
    process.env = env;
  });

  it("isRemoteOmniDataUrl detects Railway hosts", () => {
    assert.equal(isRemoteOmniDataUrl("https://omnipresence-engine-production.up.railway.app"), true);
    assert.equal(isRemoteOmniDataUrl("http://localhost:8787"), false);
  });

  it("allows dev key on localhost", () => {
    process.env.OMNIDATA_BASE_URL = "http://localhost:8787";
    delete process.env.OMNIDATA_API_KEY;
    assert.doesNotThrow(() => assertOmniDataClientConfigured());
    assert.equal(resolveOmniDataApiKey(), OMNIDATA_DEV_KEY);
  });

  it("throws on remote URL without API key", () => {
    process.env.OMNIDATA_BASE_URL = "https://omnipresence-engine-production.up.railway.app";
    delete process.env.OMNIDATA_API_KEY;
    assert.throws(() => assertOmniDataClientConfigured(), /OMNIDATA_API_KEY must be set/);
    assert.throws(() => resolveOmniDataApiKey(), /OMNIDATA_API_KEY must be set/);
  });

  it("throws on remote URL with dev-local-key", () => {
    process.env.OMNIDATA_BASE_URL = "https://omnipresence-engine-production.up.railway.app";
    process.env.OMNIDATA_API_KEY = OMNIDATA_DEV_KEY;
    assert.throws(() => assertOmniDataClientConfigured(), /dev-local-key/);
  });
});
