export default function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="surface empty">
      <div className="empty-title">{title}</div>
      {description && <div className="empty-sub">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
