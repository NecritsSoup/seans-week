import type { Category, CategoryId } from './types';

export const CATEGORIES: Category[] = [
  { id: 'work', label: 'Meetings / Work', colorToken: 'cat-work' },
  { id: 'gym', label: 'Gym', colorToken: 'cat-gym' },
  { id: 'reading', label: 'Reading', colorToken: 'cat-reading' },
  { id: 'dinner', label: 'Family Dinner', colorToken: 'cat-dinner' },
  { id: 'walk', label: 'Walk / Watering', colorToken: 'cat-walk' },
  { id: 'upenn', label: 'UPenn', colorToken: 'cat-upenn' },
];

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

export function categoryById(id: CategoryId): Category {
  return byId.get(id) ?? CATEGORIES[0];
}
