import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import bash from "shiki/langs/bash.mjs";
import http from "shiki/langs/http.mjs";
import json from "shiki/langs/json.mjs";
import yaml from "shiki/langs/yaml.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";
import { CodeCopyButton } from "@/components/copy-button";

// Synchronous highlighter, so docs sections stay plain JSX. Add a grammar
// here before using a new `lang`.
const highlighter = createHighlighterCoreSync({
  themes: [githubLight, githubDark],
  langs: [bash, http, json, yaml],
  engine: createJavaScriptRegexEngine(),
});

export type CodeLang = "bash" | "http" | "json" | "yaml" | "text";

/** `label` names the block for screen readers and the copy button. */
export function CodeBlock({ code, label, lang = "text" }: { code: string; label: string; lang?: CodeLang }) {
  // Shiki escapes the code, so this HTML holds no markup from `code`.
  const html = highlighter.codeToHtml(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
    // Shiki makes <pre> focusable for scrolling; name it as a region.
    transformers: [{ pre(node) { Object.assign(node.properties, { role: "region", "aria-label": label }); } }],
  });

  return (
    <div className="relative my-5 min-w-0">
      <CodeCopyButton value={code} label={label} />
      <div
        className="overflow-x-auto rounded-2xl border bg-card p-6 text-sm leading-relaxed [&_code]:font-mono [&_pre]:bg-transparent [&_pre]:font-mono"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
