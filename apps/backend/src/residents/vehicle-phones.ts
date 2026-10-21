import { displayPhone } from '../shared/phone.js';

// The phones shown to a neighbour who found a car by its plate. The consent
// of the apartment is needed, and only the numbers that belong to this car
// are shown: those written for its owner, or else the number the resident who
// added the car shared from MAX. Phones of the other residents of the
// apartment are never given out with someone else's car.
export type LookupVehicle = {
  userId: string;
  owner: { phones: string[] } | null;
  user: { sharedPhone: string | null } | null;
  apartment: {
    profile: { phoneConsentAt: Date | null; phoneVisibility: string } | null;
    memberships: Array<{ userId: string }>;
  } | null;
};

// What to select for a vehicle so that lookupPhones can decide.
export const lookupVehicleInclude = {
  owner: true,
  user: { select: { sharedPhone: true } },
} as const;

export function lookupPhones(vehicle: LookupVehicle): string[] {
  const profile = vehicle.apartment?.profile;
  if (!profile?.phoneConsentAt || profile.phoneVisibility !== 'vehicle_lookup') return [];
  if (vehicle.owner?.phones.length) return vehicle.owner.phones.map(displayPhone);
  const adderLivesThere = vehicle.apartment!.memberships.some((membership) => membership.userId === vehicle.userId);
  return adderLivesThere && vehicle.user?.sharedPhone ? [displayPhone(vehicle.user.sharedPhone)] : [];
}
