'use client';

import { useRouter } from 'next/navigation';
import { GroceryRequestsPanel } from './GroceryRequestsPanel';
import styles from './BetaShell.module.css';

export function BetaGroceries({ testData }: { testData: boolean }) {
  const router = useRouter();
  return (
    <div className={styles.groceriesPage}>
      <div className={styles.pageHeading}>
        <div><p className={styles.eyebrow}>Beta feature</p><h1>Groceries</h1></div>
        <p>{testData ? 'Test requests only · No real shopping' : 'Your separate beta grocery list'}</p>
      </div>
      <GroceryRequestsPanel embedded onClose={() => router.push('/beta')}
        description={testData
          ? 'Requests are saved to the test list. Simulated cart results are not purchases.'
          : 'Save requests to the beta list. Cart updates appear here when Claude processes it.'} />
    </div>
  );
}
