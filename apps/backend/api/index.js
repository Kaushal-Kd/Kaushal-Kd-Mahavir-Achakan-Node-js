import awsLambdaFastify from '@fastify/aws-lambda';

import { build } from '../src/server.js';

const app = await build();
export const handler = awsLambdaFastify(app);
