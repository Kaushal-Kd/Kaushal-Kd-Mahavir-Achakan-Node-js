import awsLambdaFastify from '@fastify/aws-lambda';

let proxyPromise;

async function getProxy() {
  if (!proxyPromise) {
    proxyPromise = import('../apps/backend/src/server.js')
      .then((mod) => mod.build())
      .then((app) => awsLambdaFastify(app));
  }
  return proxyPromise;
}

export default async function handler(event, context) {
  const proxy = await getProxy();
  return proxy(event, context);
}
