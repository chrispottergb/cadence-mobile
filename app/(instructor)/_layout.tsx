import { ExperienceTabs } from '@/ui/shell';
import { InstructorTutorialProvider } from '@/builder/InstructorTutorial';

export default function InstructorLayout() {
  return (
    <InstructorTutorialProvider><ExperienceTabs
      title="Instructor"
      tabs={[
        { name: 'index', label: 'Home' },
        { name: 'create', label: 'Create' },
        { name: 'library', label: 'Library' },
        { name: 'students', label: 'Students' },
        { name: 'gym', label: 'Gym' },
      ]}
    /></InstructorTutorialProvider>
  );
}
