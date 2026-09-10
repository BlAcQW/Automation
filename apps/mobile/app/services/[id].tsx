import { useLocalSearchParams } from 'expo-router';
import { useServices } from '@/api/hooks';
import { ServiceForm } from '@/features/services/ServiceForm';

// Reuses the services list cache to prefill; the list is loaded when arriving
// here from the Services tab.
export default function EditService() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useServices();
  const existing = data?.find((s) => s.id === String(id));
  return <ServiceForm existing={existing} />;
}
