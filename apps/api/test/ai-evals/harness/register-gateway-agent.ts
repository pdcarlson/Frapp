/**
 * Jest setup for the eval project: registers the gateway-backed agent so the
 * behavioural cases run. The server switch is turned on for this process
 * only; the gateway makes no call without it.
 */
import { createGatewayAgent } from './gateway-agent';
import { registerAgentUnderTest } from './registry';

process.env.AI_ENABLED = 'true';
registerAgentUnderTest(createGatewayAgent());
