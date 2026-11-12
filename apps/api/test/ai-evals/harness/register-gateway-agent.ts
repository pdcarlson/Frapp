/**
 * Jest setup for the eval project: registers the gateway-backed agent so the
 * behavioural cases run. The server switch is turned on for this process
 * only; the gateway makes no call without it.
 *
 * When `AI_EVALS_AGENT_MODULE` names another agent, this one is not
 * registered, so the named module is what the cases run against.
 */
import { createGatewayAgent } from './gateway-agent';
import { registerAgentUnderTest } from './registry';

process.env.AI_ENABLED = 'true';
if (!process.env.AI_EVALS_AGENT_MODULE) {
  registerAgentUnderTest(createGatewayAgent());
}
