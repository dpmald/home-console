import Link from 'next/link';
import styles from './BetaShell.module.css';

export function BetaHub({ testData }: { testData: boolean }) {
  return (
    <>
      <section className={styles.introduction} aria-labelledby="beta-title">
        <div>
          <p className={styles.eyebrow}>A space for new ideas</p>
          <h1 id="beta-title">Your kitchen,<br /><span>with room to try.</span></h1>
          <p className={styles.introText}>Explore new features here while your everyday kitchen stays familiar. Head back whenever you like.</p>
        </div>
        <aside className={styles.modeNote}>
          <span className={styles.noteIcon} aria-hidden="true">✦</span>
          <p className={styles.noteTitle}>{testData ? 'A separate test space' : 'You’re in Beta'}</p>
          <p>{testData ? 'This space uses a test grocery list. Nothing here confirms a real purchase.' : 'Experimental features and their lists live here, separate from the normal kitchen screen.'}</p>
        </aside>
      </section>

      <section aria-labelledby="features-title">
        <div className={styles.sectionHeading}>
          <h2 id="features-title">Try in Beta</h2>
          <span>1 feature</span>
        </div>
        <article className={styles.featureCard}>
          <div className={styles.featureArt} aria-hidden="true">
            <div className={styles.artDisc}>
              <svg viewBox="0 0 200 200" fill="none">
                <path d="m63 90 20-42M137 90l-20-42" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
                <path d="M49 90h102l-13 66a11 11 0 0 1-11 9H73a11 11 0 0 1-11-9L49 90Z" fill="currentColor" fillOpacity=".13" stroke="currentColor" strokeWidth="6" strokeLinejoin="round" />
                <path d="M43 89h114M82 111v32M100 111v32M118 111v32" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
                <path d="M153 46c-19 1-29 12-26 29 16 1 26-9 26-29Z" fill="currentColor" fillOpacity=".75" />
                <path d="m128 73 13-14" stroke="var(--surface, #fff)" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </div>
            <span className={styles.artCaption}>A little less to remember.</span>
          </div>
          <div className={styles.featureBody}>
            <div className={styles.featureMeta}>
              <span className={styles.featureCategory}>Groceries</span>
              <span className={styles.featureStatus}>{testData ? 'Test list' : 'Beta list'}</span>
            </div>
            <h3>Saturday grocery list</h3>
            <p>Milk, paper towels, the things you just remembered. Add household requests with quantities and see their saved status in one place.</p>
            <p className={styles.featureDetail}>Cart updates appear here when Claude processes this list. Adding a request does not place an order.</p>
            <Link className={styles.openButton} href="/beta/groceries" prefetch={false}>
              Open groceries <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </article>
      </section>
      <p className={styles.footerNote}>The normal kitchen is always one tap away.</p>
    </>
  );
}
