import { deploymentEnvironment } from './deployment-environment';

describe('deploymentEnvironment', () => {
  it.each([
    ['production', 'production'],
    ['staging', 'staging'],
    [' production ', 'production'],
    ['development', 'local'],
    ['test', 'local'],
    ['', 'local'],
    [undefined, 'local'],
    // Case matters: Render sets these exact strings, and a near-miss is not
    // production.
    ['Production', 'local'],
  ])('reads NODE_ENV %p as %s', (nodeEnv, expected) => {
    expect(deploymentEnvironment(nodeEnv)).toBe(expected);
  });
});
