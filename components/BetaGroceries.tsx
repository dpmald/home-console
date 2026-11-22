'use client';

import { GroceryRequestsPanel } from './GroceryRequestsPanel';
import styles from './BetaShell.module.css';

export function BetaGroceries({ testData, hostedUrl, canWrite, unlockAvailable }: {
  testData: boolean; hostedUrl: string | null; canWrite: boolean; unlockAvailable: boolean;
}) {
  return (
    <div className={styles.groceriesPage}>
      <div className={styles.pageHeading}>
        <div><p className={styles.eyebrow}>Beta feature</p><h1>Groceries</h1></div>
        <p>{hostedUrl
          ? <>This list stays on this PC. <a href={hostedUrl} target="_top" referrerPolicy="no-referrer">Open the shared grocery list</a></>
          : testData ? 'Test requests only · No real shopping' : 'Your shared Beta grocery list'}</p>
      </div>
      <GroceryRequestsPanel embedded canWrite={canWrite} unlockAvailable={unlockAvailable} onClose={() => window.location.assign('/beta')}
        description={testData
          ? 'Requests are saved to the test list. Simulated cart results are not purchases.'
          : 'Request items for your shared Instacart cart. “In cart” appears after the cart is checked. Warren handles checkout.'} />
    </div>
  );
}
