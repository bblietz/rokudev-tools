export type ProvenanceInput = {
  spec_version: 1 | 2;
  template: { id: string; version: string };
  modules: Array<{ id: string; version: string; files: string[] }>;
  init_order: string[];
  manifest_keys: string[];
  brs_gen_version: string;
};

function stableStringify(obj: unknown): string {
  // Reject undefined explicitly. JSON.stringify(undefined) returns the
  // JS value `undefined` (not a string), which would splice into the
  // output and produce invalid JSON. The provenance shape is static
  // (ProvenanceInput has no optional fields at present); this guard
  // catches future additions that forget to default their value.
  if (obj === undefined) {
    throw new Error(
      'stableStringify: undefined is not JSON-serializable; provide a default or omit the key',
    );
  }
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  if (obj && typeof obj === 'object') {
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    return `{${keys
      .filter((k) => (obj as Record<string, unknown>)[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + stableStringify((obj as Record<string, unknown>)[k]))
      .join(',')}}`;
  }
  return JSON.stringify(obj);
}

export function buildProvenance(input: ProvenanceInput): string {
  // init_order is semantic and must be preserved as given; all other arrays are sorted.
  const normalized = {
    brs_gen_version: input.brs_gen_version,
    init_order: input.init_order,
    manifest_keys: [...input.manifest_keys].sort(),
    modules: [...input.modules]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((m) => ({ files: [...m.files].sort(), id: m.id, version: m.version })),
    spec_version: input.spec_version,
    template: { id: input.template.id, version: input.template.version },
  };
  return stableStringify(normalized);
}
