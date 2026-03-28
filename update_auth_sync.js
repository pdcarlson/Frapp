const fs = require('fs');
const path = require('path');

function replaceInFile(filePath, replacements) {
  const fullPath = path.join(__dirname, filePath);
  if (!fs.existsSync(fullPath)) return;
  let content = fs.readFileSync(fullPath, 'utf8');
  for (const [search, replace] of replacements) {
    content = content.replace(search, replace);
  }
  fs.writeFileSync(fullPath, content, 'utf8');
}

// 1. Modules
const modules = [
  'apps/api/src/modules/invite/invite.module.ts',
  'apps/api/src/modules/notification/notification.module.ts',
  'apps/api/src/modules/chapter/chapter.module.ts',
  'apps/api/src/modules/user/user.module.ts'
];
for (const mod of modules) {
  replaceInFile(mod, [
    [/import \{ AuthSyncInterceptor \} from '\.\.\/\.\.\/interface\/interceptors\/auth-sync\.interceptor';/g, "import { AuthSyncGuard } from '../../interface/guards/auth-sync.guard';"],
    [/AuthSyncInterceptor,/g, "AuthSyncGuard,"]
  ]);
}

// 2. Controllers
const controllers = [
  'apps/api/src/interface/controllers/notification.controller.ts',
  'apps/api/src/interface/controllers/chapter.controller.ts',
  'apps/api/src/interface/controllers/invite.controller.ts'
];
for (const ctrl of controllers) {
  replaceInFile(ctrl, [
    [/import \{ AuthSyncInterceptor \} from '\.\.\/interceptors\/auth-sync\.interceptor';/g, "import { AuthSyncGuard } from '../guards/auth-sync.guard';"],
    [/@UseInterceptors\(AuthSyncInterceptor\)/g, "@UseGuards(AuthSyncGuard)"]
  ]);
}

// 3. Controller Specs
const specs = [
  'apps/api/src/interface/controllers/notification.controller.spec.ts',
  'apps/api/src/interface/controllers/chapter.controller.spec.ts'
];
for (const spec of specs) {
  replaceInFile(spec, [
    [/import \{ AuthSyncInterceptor \} from '\.\.\/interceptors\/auth-sync\.interceptor';/g, "import { AuthSyncGuard } from '../guards/auth-sync.guard';"],
    [/\.overrideInterceptor\(AuthSyncInterceptor\)/g, ".overrideGuard(AuthSyncGuard)"]
  ]);
}
