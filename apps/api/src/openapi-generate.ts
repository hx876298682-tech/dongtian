import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { createOpenApiDocument } from './openapi.js';

try {
  const outputPath = resolve(process.cwd(), 'src/generated/openapi.json');
  const document = await createOpenApiDocument();
  const serializedDocument = JSON.stringify(document, null, 2);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${serializedDocument}\n`);
  writeFileSync(
    resolve(process.cwd(), 'src/generated/openapi.ts'),
    `export const openApiDocument = ${serializedDocument} as const;\n\nexport type OpenApiDocument = typeof openApiDocument;\n`,
  );
} catch (error: unknown) {
  console.error('OpenAPI generation failed.', error instanceof Error ? error.message : 'unknown');
  process.exitCode = 1;
}
