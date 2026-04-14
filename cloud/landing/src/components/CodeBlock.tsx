export function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  return (
    <pre className="rounded-lg border border-[var(--border)] bg-[var(--code-bg)] p-4 overflow-x-auto text-sm font-mono leading-relaxed">
      <code data-lang={lang}>{code}</code>
    </pre>
  );
}
