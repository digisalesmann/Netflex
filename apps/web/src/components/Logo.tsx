import { site } from '@/lib/site';

/**
 * The official Netflex logo (source: public/netflex_black_transparent.png).
 * - "lockup": mark beside wordmark, for the slim header bar.
 * - "stacked": the full logo as drawn, for footers and standalone pages.
 * Black artwork; the `.logo--invert` class turns it white on dark backgrounds.
 */
export function Logo({
  variant = 'lockup',
  decorative = false,
  className = '',
}: {
  variant?: 'lockup' | 'stacked';
  /** True when a parent (e.g. a link with aria-label) already names it. */
  decorative?: boolean;
  className?: string;
}) {
  const alt = decorative ? '' : site.brand;
  if (variant === 'stacked') {
    return (
      <img
        className={`logo logo--stacked ${className}`}
        src="/brand/netflex-logo.png"
        alt={alt}
        width={285}
        height={240}
      />
    );
  }
  return (
    <span
      className={`logo logo--lockup ${className}`}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : alt}
    >
      <img className="logo__mark" src="/brand/netflex-mark.png" alt="" width={112} height={96} />
      <img
        className="logo__word"
        src="/brand/netflex-wordmark.png"
        alt=""
        width={276}
        height={60}
      />
    </span>
  );
}
