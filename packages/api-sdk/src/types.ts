/**
 * Placeholder types — will be regenerated from the new OpenAPI spec.
 * Run `npm run openapi:export -w apps/api && npm run generate -w packages/api-sdk`
 */

export interface paths {
  "/health": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": {
              status: string;
              database: string;
              uptime: number;
            };
          };
        };
      };
    };
  };
}

export type webhooks = Record<string, never>;
export interface components {
  schemas: Record<string, never>;
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
