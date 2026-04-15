export default function PageHeader({
  title,
  description,
  actions,
  badge,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 flex-wrap">
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-3">
          <h1 className="text-[24px] font-medium tracking-tight">{title}</h1>
          {badge}
        </div>
        {description && (
          <p className="text-[13px] max-w-[62ch]" style={{ color: "var(--text-dim)" }}>
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}
