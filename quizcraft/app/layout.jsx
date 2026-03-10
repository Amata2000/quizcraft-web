import './globals.css';

export const metadata = {
  title: 'QuizCraft',
  description: 'Online quiz platform for teachers and students',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
