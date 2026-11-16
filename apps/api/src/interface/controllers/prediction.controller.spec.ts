import { PredictionController } from './prediction.controller';
import type { PredictionService } from '../../application/services/prediction.service';
import type { RbacService } from '../../application/services/rbac.service';
import { SystemPermissions } from '#domain/constants/permissions';

/**
 * Who counts as an officer for settle and void: `predictions:manage`, or
 * `*` (a President). The service decides the rest.
 */
describe('PredictionController', () => {
  const build = (permissions: string[]) => {
    const predictions = {
      void: jest.fn().mockResolvedValue({}),
      settle: jest.fn().mockResolvedValue({}),
      consent: jest.fn().mockResolvedValue(null),
    };
    const rbac = {
      getEffectivePermissions: jest.fn().mockResolvedValue(permissions),
    };
    const controller = new PredictionController(
      predictions as unknown as PredictionService,
      rbac as unknown as RbacService,
    );
    return { controller, predictions, rbac };
  };

  it.each([
    [['*'], true],
    [[SystemPermissions.PREDICTIONS_MANAGE], true],
    [
      [SystemPermissions.MEMBERS_VIEW, SystemPermissions.PREDICTIONS_CREATE],
      false,
    ],
  ])(
    'passes manages for %j as %s to void and settle',
    async (perms, manages) => {
      const { controller, predictions, rbac } = build(perms);
      await controller.void('m', 'chapter', 'user', null);
      await controller.settle('m', 'chapter', 'user', null, { answer_id: 'a' });
      expect(rbac.getEffectivePermissions).toHaveBeenCalledWith(
        'chapter',
        'user',
      );
      expect(predictions.void.mock.calls[0][2]).toEqual({ manages });
      expect(predictions.settle.mock.calls[0][3]).toEqual({ manages });
    },
  );

  it('wraps a declined consent as a null prediction', async () => {
    const { controller } = build([]);
    await expect(
      controller.consent('m', 'chapter', 'user', null, { agree: false }),
    ).resolves.toEqual({ prediction: null });
  });
});
