export type ChoiceValue = string | number;
export interface ChoiceOption<T extends ChoiceValue = ChoiceValue> {
  value: T;
  label: string;
  detail?: string;
  disabled?: boolean;
}

// Bulk actions only touch visible, editable choices. Locked or filtered-out
// selections remain intact, so a UI convenience cannot expand authorization.
export function updateChoiceSelection<T extends ChoiceValue>(selected: readonly T[], choices: readonly ChoiceOption<T>[], checked: boolean): T[] {
  const next = new Set(selected);
  for (const choice of choices) {
    if (choice.disabled) continue;
    if (checked) next.add(choice.value);
    else next.delete(choice.value);
  }
  return [...next];
}
