import { ExperienceTabs } from '@/ui/shell';

export default function StudentLayout() {
  return (
    <ExperienceTabs
      title="Student"
      tabs={[
        { name: 'index', label: 'Home' },
        { name: 'schedule', label: 'Schedule' },
        { name: 'create', label: 'Create' },
        { name: 'music', label: 'Music' },
        { name: 'profile', label: 'Profile' },
      ]}
    />
  );
}
