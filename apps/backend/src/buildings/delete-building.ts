import type { Prisma } from '@prisma/client';

// Everything of a house goes with it: incidents with their photos, comments
// and notifications, apartments with their residents' links, profiles and
// cars. Residents of the house are disconnected and choose a house again.
export async function deleteBuildingData(tx: Prisma.TransactionClient, buildingId: string) {
  const incidents = await tx.incident.findMany({ where: { buildingId }, select: { id: true } });
  const incidentIds = incidents.map((incident) => incident.id);
  // The files of the photos are removed by the caller once the transaction is
  // committed: a rolled back deletion must not lose them.
  const photoIds = incidentIds.length ? (await tx.incidentPhoto.findMany({ where: { incidentId: { in: incidentIds } }, select: { id: true } })).map((photo) => photo.id) : [];
  if (incidentIds.length) {
    await tx.outboxMessage.deleteMany({ where: { incidentId: { in: incidentIds } } });
    await tx.incidentPhoto.deleteMany({ where: { incidentId: { in: incidentIds } } });
    await tx.incidentComment.deleteMany({ where: { incidentId: { in: incidentIds } } });
    await tx.incidentEvent.deleteMany({ where: { incidentId: { in: incidentIds } } });
    await tx.incidentSubscription.deleteMany({ where: { incidentId: { in: incidentIds } } });
    await tx.report.deleteMany({ where: { incidentId: { in: incidentIds } } });
    await tx.incident.deleteMany({ where: { id: { in: incidentIds } } });
  }
  const memberships = await tx.residentMembership.count({ where: { apartment: { buildingId }, revokedAt: null } });
  await tx.residentMembership.deleteMany({ where: { apartment: { buildingId } } });
  await tx.vehicle.deleteMany({ where: { apartment: { is: { buildingId } } } });
  await tx.residentProfile.deleteMany({ where: { apartment: { is: { buildingId } } } });
  await tx.apartment.deleteMany({ where: { buildingId } });
  await tx.building.delete({ where: { id: buildingId } });
  return { revokedMemberships: memberships, deletedIncidents: incidentIds.length, photoIds };
}
