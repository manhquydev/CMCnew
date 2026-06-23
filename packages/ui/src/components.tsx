import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Button({ children, style, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      style={{
        background: 'var(--cmc-brand)',
        color: '#fff',
        border: 'none',
        borderRadius: 'var(--cmc-radius)',
        padding: '10px 16px',
        font: 'inherit',
        fontWeight: 600,
        cursor: 'pointer',
        opacity: rest.disabled ? 0.6 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function Card({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <section
      style={{
        background: 'var(--cmc-surface)',
        border: '1px solid var(--cmc-border)',
        borderRadius: 'var(--cmc-radius)',
        boxShadow: 'var(--cmc-shadow)',
        padding: 'var(--cmc-space-4)',
      }}
    >
      {title && <h3 style={{ margin: '0 0 var(--cmc-space-3)' }}>{title}</h3>}
      {children}
    </section>
  );
}

export function Field({ label, ...rest }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: 'block', marginBottom: 'var(--cmc-space-3)' }}>
      <span style={{ display: 'block', fontSize: 13, color: 'var(--cmc-text-muted)', marginBottom: 4 }}>
        {label}
      </span>
      <input
        {...rest}
        style={{
          width: '100%',
          padding: '10px 12px',
          border: '1px solid var(--cmc-border)',
          borderRadius: 'var(--cmc-radius)',
          font: 'inherit',
        }}
      />
    </label>
  );
}
