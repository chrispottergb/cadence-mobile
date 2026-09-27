import { ExperienceTabs } from '@/ui/shell';

export default function ParentLayout() {
  return (
    <ExperienceTabs
      title="Parent"
      tabs={[
        { name: 'index', label: 'Home' },
        { name: 'schedule', label: 'Schedule' },
        { name: 'students', label: 'Students' },
        { name: 'messages', label: 'Messages' },
        { name: 'profile', label: 'Profile' },
      ]}
    />
  );
}
