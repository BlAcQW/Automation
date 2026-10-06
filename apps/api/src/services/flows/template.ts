/** {var} interpolation. Only [a-z][a-z0-9_]* names count; any other braces are literal text. */
const VAR_REF = /\{([a-z][a-z0-9_]*)\}/g;

export function templateVars(text: string): string[] {
    return [...text.matchAll(VAR_REF)].map((m) => m[1]);
}

/** Unknown variables render as an empty string (never "undefined" in a customer message). */
export function renderTemplate(text: string, vars: Readonly<Record<string, string>>): string {
    return text.replace(VAR_REF, (_m, name: string) => Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : '');
}
