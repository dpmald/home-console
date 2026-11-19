'use client';

import Link from 'next/link';
import styles from '@/components/BetaShell.module.css';

export default function BetaError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className={styles.errorCard} role="alert">
      <p className={styles.eyebrow}>Beta feature unavailable</p>
      <h1>This Beta screen could not load.</h1>
      <p>Try opening the feature again, or use Back to kitchen above to return to the normal screen.</p>
      <div className={styles.errorActions}>
        <button className={styles.openButton} type="button" onClick={reset}>Try again</button>
        <Link href="/beta" prefetch={false} className={styles.secondaryButton}>Back to Beta</Link>
      </div>
    </section>
  );
}
