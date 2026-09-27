import { ExperienceTabs } from '@/ui/shell';

export default function InstructorLayout() {
  return (
    <ExperienceTabs
      title="Instructor"
      tabs={[
        { name: 'index', label: 'Home' },
        { name: 'create', label: 'Create' },
        { name: 'library', label: 'Library' },
        { name: 'students', label: 'Students' },
        { name: 'gym', label: 'Gym' },
      ]}
    />
  );
}
