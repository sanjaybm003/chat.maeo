import type { WeightedField } from "@/lib/search/fuzzy";
import type { Member } from "@/types/domain";

/** Names matter most, then email, then role. */
export function memberSearchFields(member: Member): WeightedField[] {
  return [
    [member.displayName, 1],
    [member.fullName, 1],
    [member.email, 0.7],
    [member.title, 0.5],
  ];
}
