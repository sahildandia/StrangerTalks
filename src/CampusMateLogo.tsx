export default function CampusMateLogo({ className = '' }: { className?: string }) {
  return <svg className={`campusmate-logo-svg ${className}`} viewBox="0 0 64 64" width="64" height="64" fill="none" aria-hidden="true">
    <path d="M17 10h30a8 8 0 0 1 8 8v19a8 8 0 0 1-8 8H32L19 55v-10h-2a8 8 0 0 1-8-8V18a8 8 0 0 1 8-8Z" fill="white"/>
    <path d="m18 25 14-7 14 7-14 7-14-7Z" fill="#7740E8"/>
    <path d="M23 29v7c5 4 13 4 18 0v-7l-9 4-9-4Z" fill="#7740E8"/>
    <path d="M46 26v8" stroke="#7740E8" strokeWidth="2.5" strokeLinecap="round"/>
    <circle cx="46" cy="37" r="1.8" fill="#7740E8"/>
  </svg>;
}
