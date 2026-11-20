import type { ReactNode } from 'react';
import Link from 'next/link';
import styles from './BetaShell.module.css';

export function BetaShell({ children, kitchenUrl, testData }: {
  children: ReactNode;
  kitchenUrl: string;
  testData: boolean;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/beta" prefetch={false} className={styles.brand} aria-label="Home Console Beta home">
            <span className={styles.brandMark} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="m3 10 9-7 9 7v10H3V10Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M9 20v-7h6v7" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
            </span>
            <span className={styles.brandName}>Home Console <span className={styles.betaBadge}>Beta</span></span>
          </Link>
          <div className={styles.headerActions}>
            {testData && <span className={styles.testBadge}>Test data</span>}
            <a className={styles.backButton} href={kitchenUrl} target="_top" referrerPolicy="no-referrer">
              <span aria-hidden="true">←</span> Back to kitchen
            </a>
          </div>
        </div>
      </header>
      <div className={styles.scrollArea}>
        <main className={styles.content} id="beta-content">{children}</main>
      </div>
    </div>
  );
}
