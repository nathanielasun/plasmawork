/**
 * Card — rounded panel with title + subtitle + optional action.
 *
 * Styling lives in styles.css under `.card` / `.card-header` / `.card-title` /
 * `.card-subtitle` / `.card-action`. Pass `nested` for the inset slate-fill
 * variant used inside another card.
 */
import type { PropsWithChildren, ReactNode } from "react";

export interface CardProps {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  /** Render as a nested panel (slate fill) instead of an outer card. */
  nested?: boolean;
  className?: string;
}

export function Card({
  title,
  subtitle,
  action,
  nested,
  className,
  children,
}: PropsWithChildren<CardProps>) {
  const base = nested ? "card-panel" : "card";
  return (
    <section className={className ? `${base} ${className}` : base}>
      {(title || action) && (
        <header className="card-header">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {action && <div className="card-action">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export default Card;
