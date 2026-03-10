'use client';
import dynamic from 'next/dynamic';

// Dynamically import the app so it only runs client-side
// (it uses browser APIs like navigator.clipboard)
const QuizCraftApp = dynamic(() => import('../components/QuizCraftApp'), {
  ssr: false,
  loading: () => (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', fontFamily: 'serif', color: '#6a6560', fontSize: '1.1rem'
    }}>
      Loading QuizCraft…
    </div>
  ),
});

export default function Page() {
  return <QuizCraftApp />;
}
