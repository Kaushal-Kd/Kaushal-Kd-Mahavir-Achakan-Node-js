// The supported deployments place exactly one sanitized client address in
// X-Forwarded-For. Trusting one hop prevents earlier, client-supplied values
// from becoming request.ip.
export const TRUSTED_PROXY_HOPS = 1;
