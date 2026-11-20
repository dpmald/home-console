'use client';

import { GroceryRequestsPanel } from './GroceryRequestsPanel';
import styles from './BetaShell.module.css';

export function BetaGroceries({ testData, hostedUrl }: { testData: boolean; hostedUrl: string | null }) {
  return (
    <div className={styles.groceriesPage}>
      <div className={styles.pageHeading}>
        <div><p className={styles.eyebrow}>Beta feature</p><h1>Groceries</h1></div>
        <p>{hostedUrl
          ? <>This list stays on this PC. <a href={hostedUrl} target="_top" referrerPolicy="no-referrer">Open the hosted Beta list for Claude</a></>
          : testData ? 'Test requests only · No real shopping' : 'Your shared Beta grocery list'}</p>
      </div>
      <GroceryRequestsPanel embedded onClose={() => window.location.assign('/beta')}
        description={testData
          ? 'Requests are saved to the test list. Simulated cart results are not purchases.'
          : 'Save requests to the beta list. Cart updates appear here when Claude processes it.'} />
    </div>
  );
}
