/**
 * Jest setup for the eval project: registers the gateway-backed agent so the
 * behavioural cases run. The server switch is turned on for this process
 * only; the gateway makes no call without it.
 *
 * The model is the scripted one unless `AI_EVALS_MODEL` names a bake-off
 * candidate (`bake-off/candidates.ts`), which puts that model behind the
 * same agent and the same cases (#4311). A paid candidate also needs its
 * credentials and `AI_EVALS_ALLOW_PAID=1`; CI sets none of them.
 *
 * When `AI_EVALS_AGENT_MODULE` names another agent, this one is not
 * registered, so the named module is what the cases run against.
 */
import { candidateRegistry } from '../bake-off/candidate-registry';
import { findCandidate } from '../bake-off/candidates';
import { createGatewayAgent } from './gateway-agent';
import { registerAgentUnderTest } from './registry';
import { scriptedAskModel } from './scripted-model';

process.env.AI_ENABLED = 'true';
if (!process.env.AI_EVALS_AGENT_MODULE) {
  const model = process.env.AI_EVALS_MODEL;
  if (model && model !== 'scripted') {
    const candidate = findCandidate(model);
    const { registry } = candidateRegistry(candidate, {
      'ask.answer': scriptedAskModel,
    });
    registerAgentUnderTest(
      createGatewayAgent({ registry, name: `gateway + ${candidate.model}` }),
    );
  } else {
    registerAgentUnderTest(createGatewayAgent());
  }
}
