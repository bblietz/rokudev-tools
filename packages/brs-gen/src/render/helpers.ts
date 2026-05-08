export type Helpers = {
  xmlEscape(s: string): string;
};

export function makeHelpers(): Helpers {
  return {
    xmlEscape(s: string): string {
      return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    },
  };
}
