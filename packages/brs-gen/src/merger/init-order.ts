import { fail, type Failure } from '@rokudev/device-client';
import type { ModuleToml } from '../catalog/module-toml.js';

type R =
  | { ok: true; order: string[] }
  | { ok: false; failure: Failure };

// "a before b" means a must come before b in the emitted order, so the edge
// in the DAG is a -> b (a must be resolved before b). "b after a" is the
// same edge. Kahn sorts by "nodes with no incoming edges first".
export function topoSortInitOrder(modules: ModuleToml[]): R {
  const ids = modules.map((m) => m.module.id).sort();
  const present = new Set(ids);
  const inDeg = new Map<string, number>(ids.map((id) => [id, 0]));
  const outEdges = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));

  for (const m of modules) {
    const id = m.module.id;
    for (const b of m.module_ordering.before) {
      if (!present.has(b)) continue;
      if (!outEdges.get(id)!.has(b)) {
        outEdges.get(id)!.add(b);
        inDeg.set(b, (inDeg.get(b) ?? 0) + 1);
      }
    }
    for (const a of m.module_ordering.after) {
      if (!present.has(a)) continue;
      if (!outEdges.get(a)!.has(id)) {
        outEdges.get(a)!.add(id);
        inDeg.set(id, (inDeg.get(id) ?? 0) + 1);
      }
    }
  }

  const result: string[] = [];
  // use a sorted-array queue for deterministic lexical tie-break
  const queue = ids.filter((id) => inDeg.get(id) === 0).sort();
  while (queue.length) {
    const next = queue.shift()!;
    result.push(next);
    for (const down of [...outEdges.get(next)!].sort()) {
      const newDeg = (inDeg.get(down) ?? 0) - 1;
      inDeg.set(down, newDeg);
      if (newDeg === 0) {
        // insert preserving sorted order
        const ins = queue.findIndex((q) => q > down);
        if (ins === -1) queue.push(down);
        else queue.splice(ins, 0, down);
      }
    }
  }

  if (result.length !== ids.length) {
    const unresolved = ids.filter((id) => !result.includes(id));
    return { ok: false, failure: fail('INIT_ORDER_CYCLE',
      `cycle involving modules: ${unresolved.join(', ')}`,
      { stage: 'init-order', cycle: unresolved }) };
  }
  return { ok: true, order: result };
}
