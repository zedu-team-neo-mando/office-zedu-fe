import type { TowerOffice } from "./tower-scene";

export const TOWER_PAGE_SIZE = 20;

/** Each floor keeps its directory order; paging only changes the exterior. */
export function towerOfficePage(offices: TowerOffice[], target: TowerOffice) {
  const peers = offices.filter(
    (office) =>
      office.kind === "personal" && office.floorIndex === target.floorIndex
  );
  return Math.floor(
    Math.max(
      0,
      peers.findIndex((office) => office.roomId === target.roomId)
    ) / TOWER_PAGE_SIZE
  );
}

export function towerPageOffices(offices: TowerOffice[], page: number) {
  const positions = new Map<number, number>();
  return offices.filter((office) => {
    if (office.kind !== "personal") return true;
    const index = positions.get(office.floorIndex) ?? 0;
    positions.set(office.floorIndex, index + 1);
    return Math.floor(index / TOWER_PAGE_SIZE) === page;
  });
}
