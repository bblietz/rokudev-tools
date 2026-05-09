import { readFile, writeFile } from 'node:fs/promises';
import { fail } from '@rokudev/device-client';
import { promoteV1ToV2 } from '../spec/promote.js';
import { registerToolsModule } from './_register.js';

/**
 * Produce a simple line-by-line diff showing removed and added lines.
 * Operates on unique-line membership: if both sides have the same line the
 * line is considered unchanged. Duplicates that differ in count are treated
 * as unchanged (Set-based, not multiset).
 */
function simpleDiff(before: string, after: string): string {
  const b = new Set(before.split('\n'));
  const a = new Set(after.split('\n'));
  const removed = [...b].filter((l) => !a.has(l)).map((l) => `- ${l}`);
  const added = [...a].filter((l) => !b.has(l)).map((l) => `+ ${l}`);
  return [...removed, ...added].join('\n');
}

registerToolsModule((tools) => {
  tools.set('spec_upgrade', {
    name: 'spec_upgrade',
    description:
      'Reads an AppSpec JSON file, promotes it from v1 to v2 if needed, and writes the ' +
      'result. By default writes to <file_path>.v2.json (sidecar). With in_place: true ' +
      'overwrites the original file. If the input is already v2 the tool returns a no-op ' +
      'result (written_to: null, diff: "") and does not mutate any file.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['file_path'],
      properties: {
        file_path: { type: 'string', minLength: 1 },
        in_place: { type: 'boolean' },
      },
    },
    handler: async (args) => {
      const filePath = args['file_path'] as string;
      const inPlace = (args['in_place'] as boolean | undefined) ?? false;

      // 1. Read file text.
      let text: string;
      try {
        text = await readFile(filePath, 'utf8');
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e?.code === 'ENOENT') {
          throw fail('APP_SPEC_INVALID', `spec file not found: ${filePath}`, {
            file_path: filePath,
          });
        }
        throw fail(
          'APP_SPEC_INVALID',
          `failed to read spec file: ${filePath}: ${e?.message ?? String(err)}`,
          { file_path: filePath },
        );
      }

      // 2. Parse JSON.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw fail('APP_SPEC_INVALID', `spec file is not valid JSON: ${msg}`, {
          file_path: filePath,
        });
      }

      // 3. Determine spec_version_before.
      const specVersionBefore: number =
        typeof parsed?.spec_version === 'number' ? parsed.spec_version : 1;

      // 4. Promote.
      const result = promoteV1ToV2(parsed);
      const specVersionAfter: number = result.spec.spec_version;

      // 5. Compute diff.
      const beforeStr = JSON.stringify(parsed, null, 2);
      const afterStr = JSON.stringify(result.spec, null, 2);
      const diff = simpleDiff(beforeStr, afterStr);

      // 6. No-op detection: v2 in -> v2 out, no warning, content identical.
      const isNoOp = specVersionBefore === 2 && specVersionAfter === 2 && !result.warning;

      if (isNoOp) {
        return {
          ok: true,
          spec_version_before: specVersionBefore,
          spec_version_after: specVersionAfter,
          written_to: null,
          diff: '',
        };
      }

      // 7. Determine write target.
      const writtenTo = inPlace ? filePath : `${filePath}.v2.json`;

      // 8. Write file (trailing newline for POSIX hygiene).
      await writeFile(writtenTo, afterStr + '\n', 'utf8');

      return {
        ok: true,
        spec_version_before: specVersionBefore,
        spec_version_after: specVersionAfter,
        written_to: writtenTo,
        diff,
      };
    },
  });
});
