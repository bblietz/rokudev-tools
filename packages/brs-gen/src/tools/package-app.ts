import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fail } from '@rokudev/device-client';
import { registerToolsModule } from './_register.js';
import { packageProject } from '../build/zip.js';

registerToolsModule((tools) => {
  tools.set('package_app', {
    name: 'package_app',
    description:
      'Zip an already-generated Roku project directory into a sideload-ready archive. '
      + 'Validates that project_dir contains a top-level `manifest` file before zipping. '
      + 'Default output is <project_dir>.zip.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['project_dir'],
      properties: {
        project_dir: { type: 'string', minLength: 1 },
        output_zip: { type: 'string', minLength: 1 },
        exclude: { type: 'array', items: { type: 'string' } },
      },
    },
    handler: async (args) => {
      const projectDir = args['project_dir'] as string;

      // 1. Verify top-level manifest exists.
      try {
        await stat(join(projectDir, 'manifest'));
      } catch {
        throw fail(
          'MANIFEST_VALIDATION_FAILED',
          'project_dir has no top-level manifest file',
          { project_dir: projectDir },
        );
      }

      // 2. Resolve output zip path.
      const outputZip =
        typeof args['output_zip'] === 'string' && args['output_zip'].length > 0
          ? args['output_zip']
          : `${projectDir}.zip`;

      // 3. Resolve exclude list.
      const exclude = Array.isArray(args['exclude'])
        ? (args['exclude'] as string[])
        : undefined;

      // 4. Zip the project.
      await packageProject(
        exclude !== undefined
          ? { projectDir, outputZip, exclude }
          : { projectDir, outputZip },
      );

      // 5. Stat the output zip for byte size.
      const zipStat = await stat(outputZip);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              zip_path: outputZip,
              zip_bytes: zipStat.size,
            }),
          },
        ],
      };
    },
  });
});
