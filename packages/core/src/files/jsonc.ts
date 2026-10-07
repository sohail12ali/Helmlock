// JSON with comments (JSONC), as VS Code allows in .code-workspace and settings files.
// Strips // and /* */ comments outside strings and drops trailing commas before } or ], then JSON.parse.

export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Copy `s`, passing string literals through untouched and every other position through `other`. */
function scan(s: string, other: (i: number) => [string, number]): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
      out += s.slice(i, j + 1);
      i = j + 1;
    } else {
      const [piece, next] = other(i);
      out += piece;
      i = next;
    }
  }
  return out;
}

export function parseJsonc(text: string): unknown {
  const src = stripBom(text);
  const noComments = scan(src, (i) => {
    if (src[i] === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      return ["", end < 0 ? src.length : end];
    }
    if (src[i] === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      return ["", end < 0 ? src.length : end + 2];
    }
    return [src[i]!, i + 1];
  });
  const closer = /\s*[}\]]/y;
  const clean = scan(noComments, (i) => {
    if (noComments[i] === ",") {
      closer.lastIndex = i + 1;
      if (closer.test(noComments)) return ["", i + 1];
    }
    return [noComments[i]!, i + 1];
  });
  return JSON.parse(clean);
}
