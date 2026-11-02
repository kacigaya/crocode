export const DOCS_SITE_URL = "https://kacigaya.github.io/crocode";
export const DOCS_URL = `${DOCS_SITE_URL}/docs/`;

export function canonicalDocUrl(path: string) {
  return `${DOCS_SITE_URL}${path.replace(/\/$/, "")}/`;
}

export function asset(path: `/${string}`) {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
}
