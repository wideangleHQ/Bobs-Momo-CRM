import { redirect } from 'next/navigation';

// One sign-in for everyone. Kept so a shared or bookmarked employee link still lands.
export default function EmployeeLoginPage() {
  redirect('/login');
}
