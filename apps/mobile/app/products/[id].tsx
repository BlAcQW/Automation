import { useLocalSearchParams } from 'expo-router';
import { useProducts } from '@/api/hooks';
import { ProductForm } from '@/features/products/ProductForm';

export default function EditProduct() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useProducts();
  const existing = data?.find((p) => p.id === String(id));
  return <ProductForm existing={existing} />;
}
